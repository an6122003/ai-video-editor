#!/usr/bin/env node
// A-roll cleaner. Proposes cuts from the transcript, then renders the clean cut.
//
//   node bin/aroll-clean.mjs                 # propose: writes work/cuts.json, stops
//   node bin/aroll-clean.mjs --apply         # render from work/cuts.json (or --cuts <file>)
//
// Run from the project directory (the one holding project.json and work/).
//
// What gets cut, and why each is a separate reason so a reviewer can veto a class:
//   filler   standalone um / uh / erm — hesitation noise, not words
//   stutter  the same word twice in a row within 0.6s ("as as", "we we") — the
//            FIRST copy goes, the second flows into the sentence
//   pause    a gap between words over --pause seconds, shortened to --keep-pause;
//            the words on either side are never touched
//   retake   a segment that the next segment restates (token overlap) — the
//            earlier attempt goes, the later, corrected take stays. Marked
//            `review: true`: the heuristic proposes, a human confirms.
//   flag     "let me start again", "sorry", long low-confidence stretches — not
//            cut, listed for the reviewer
//   manual   anything written into cuts.json by hand
//
// Rules the user set: keep everything the speaker MEANT to say. Normal
// breathing and pacing stay — only pauses over the threshold shrink, and they
// shrink to a natural pause, not to zero, or the cut sounds machine-made.
//
// Render is one ffmpeg pass: hardware decode -> scale to the composition size
// -> trim/concat every kept range -> libx264 with a keyframe every 30 frames,
// because the HyperFrames renderer seeks by frame and stalls on sparse GOPs.
// Audio gets 10ms fades at every join (no clicks) and loudnorm to -14 LUFS.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { hwaccelArgs } from "./lib/hwaccel.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const project = JSON.parse(await readFile("project.json", "utf8"));
const FPS = project.composition?.fps ?? 30;
const W = project.composition?.width ?? 1920;
const H = project.composition?.height ?? 1080;
const SRC = flag("--src", project.source.aroll);

const PAUSE = Number(flag("--pause", 0.7));        // gap that counts as "too long"
const KEEP_PAUSE = Number(flag("--keep-pause", 0.35)); // what it becomes
const FILLERS = flag("--fillers", "all");          // all | isolated | none
const MIN_FILLER = 0.12;                           // shorter than this is inaudible; cutting it only buys a jump
const PAD = 0.03;                                  // breathing room either side of a word cut
const RETAKE_SIM = Number(flag("--retake-sim", 0.6));
// A variant cut (a shorter version for a platform with a length cap) must not
// overwrite the master's clean transcript — every plan's phrase anchors resolve
// against it. --suffix writes work/keep<suffix>.json and
// work/transcript.clean<suffix>.json instead, so the two can coexist.
const SUFFIX = flag("--suffix", "");

const q = (t) => Math.max(0, Math.round(t * FPS) / FPS);
// q rounds to the NEAREST frame, so a boundary that merely equals a word's
// start can still round forward over it. These hold a boundary to the frame
// strictly below / above a time, for clamping a cut off its neighbours.
const qDown = (t) => Math.max(0, Math.floor(t * FPS) / FPS);
const qUp = (t) => Math.max(0, Math.ceil(t * FPS) / FPS);
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

const words = JSON.parse(await readFile("work/transcript.json", "utf8"));
const segs = JSON.parse(await readFile("work/transcript.segments.json", "utf8")).segments;

// ── propose ───────────────────────────────────────────────────────────────
const cuts = [];
const flags = [];

if (!has("--apply")) {
  // No "mm"/"ah": "3.5 mm" and "ah, yes" are words. Hesitation is um / uh / erm / hmm.
  const FILLER_RE = /^(u+m+|u+h+|er+m+|hm+)$/i;
  const DOUBLE_OK = new Set(["very", "really", "so", "many", "much", "super", "no", "yes", "okay", "ok", "again", "long"]);

  // A doubled phrase said MORE THAN ONCE across the video is a motif, not a
  // stumble — quoted speech ("it says Pika Pika... from that Pika Pika"), a
  // catchphrase, an onomatopoeia. Cutting it destroys the point being made.
  // One pass to count every doubled phrase, then those are off limits.
  const doubles = new Map();
  for (let i = 0; i < words.length; i++) {
    for (const n of [1, 2, 3]) {
      const a = words.slice(i, i + n).map((x) => norm(x.text));
      const b = words.slice(i + n, i + 2 * n).map((x) => norm(x.text));
      if (b.length < n || a.join(" ") !== b.join(" ")) continue;
      const key = a.join(" ");
      doubles.set(key, (doubles.get(key) ?? 0) + 1);
    }
  }
  const isMotif = (key) => (doubles.get(key) ?? 0) > 1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = words[i - 1], next = words[i + 1];
    const tok = norm(w.text);
    const gapBefore = prev ? w.start - prev.end : Infinity;
    const gapAfter = next ? next.start - w.end : Infinity;

    // filler
    if (FILLERS !== "none" && FILLER_RE.test(tok) && w.end - w.start >= MIN_FILLER) {
      const isolated = gapBefore >= 0.25 || gapAfter >= 0.25;
      if (FILLERS === "all" || isolated) {
        // Swallow the hesitation's own silence too, leaving a natural pause.
        let s = w.start - PAD, e = w.end + PAD;
        if (gapBefore < Infinity && gapBefore > KEEP_PAUSE) s = prev.end + KEEP_PAUSE / 2;
        if (gapAfter < Infinity && gapAfter > KEEP_PAUSE) e = next.start - KEEP_PAUSE / 2;
        // A filler spoken straight into the next word has no silence to
        // swallow, so PAD reaches past that word's START — and the start is the
        // only thing the transcript remap keys on, so the neighbour would be
        // dropped along with the "um". Observed on "your dog right um you talk
        // to your dog", which lost the "you" as well: a word the speaker meant
        // to say, against the rule at the top of this file.
        //
        // Both boundaries clamp to the neighbouring word's near EDGE, not its
        // start. The two sides fail differently and only one of them drops a
        // word: ahead of the filler, `next.start` inside the cut loses the
        // whole word; behind it, `prev.start` can never be inside the cut
        // unless the previous word is shorter than one frame, so clamping
        // there was unreachable and left PAD free to shave the tail off `prev`.
        // A 10ms clip is inaudible, but the rule at the top of this file says
        // the words on either side are never touched, and this is what makes
        // that true rather than nearly true.
        if (next) e = Math.min(e, qDown(next.start));
        if (prev) s = Math.max(s, qUp(prev.end));
        if (e - s < 1 / FPS) continue;   // nothing left once clamped — not worth a cut
        cuts.push({ start: s, end: e, reason: "filler", text: w.text, at: w.start });
        continue;
      }
    }

    // stutter: a phrase of 1-3 words immediately said again ("we we", "i'm very
    // i'm very") — drop the FIRST copy so the second flows into the sentence.
    // Deliberate intensifier doubles ("very very good") are speech, not stutter.
    let stuttered = false;
    for (const n of [3, 2, 1]) {
      const a = words.slice(i, i + n), b = words.slice(i + n, i + 2 * n);
      if (b.length < n) continue;
      const ta = a.map((x) => norm(x.text)), tb = b.map((x) => norm(x.text));
      if (ta.join(" ") !== tb.join(" ")) continue;
      if (ta.some((t) => t.length < 2 || FILLER_RE.test(t))) continue;
      if (n === 1 && DOUBLE_OK.has(ta[0])) continue;
      if (isMotif(ta.join(" "))) continue;
      if (b[0].start - a[n - 1].end > 0.6) continue;
      cuts.push({
        start: a[0].start - PAD, end: b[0].start - PAD, reason: "stutter",
        text: `${a.map((x) => x.text).join(" ")} ‖ ${b.map((x) => x.text).join(" ")}`, at: a[0].start,
      });
      stuttered = true;
      break;
    }
    if (stuttered) continue;

    // pause
    if (next && gapAfter >= PAUSE) {
      const s = w.end + KEEP_PAUSE / 2, e = next.start - KEEP_PAUSE / 2;
      if (e - s > 0.1) cuts.push({ start: s, end: e, reason: "pause", text: `${gapAfter.toFixed(2)}s gap`, at: w.end });
    }
  }

  // retakes: compare each segment with the next two.
  // Frame words are excluded from the comparison because a PARALLEL LIST
  // ("It may feel angry. It may feel surprised. It may feel happy.") shares its
  // frame by design and would otherwise look like a restatement every time. The
  // test that separates the two: a retake says the SAME thing again, so the
  // later segment introduces little new content — a list item introduces a lot.
  const FRAME = new Set(["the", "and", "that", "this", "you", "your", "they", "them", "there", "then",
    "was", "were", "are", "is", "be", "been", "have", "has", "had", "will", "would", "can", "could",
    "may", "might", "just", "very", "really", "kind", "like", "about", "with", "from", "for", "into",
    "not", "but", "all", "one", "our", "out", "own", "also", "essentially", "actually", "thing", "things",
    "feel", "feels", "think", "thought", "know", "mean", "want", "make", "made", "get", "got", "going"]);
  const toks = (s) => s.words.map((w) => norm(w.text)).filter((t) => t.length > 2);
  const content = (s) => toks(s).filter((t) => !FRAME.has(t));
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    const ta = content(a);
    if (ta.length < 3) continue;
    for (let j = i + 1; j <= Math.min(i + 2, segs.length - 1); j++) {
      const b = segs[j];
      const cb = content(b);
      const tb = new Set(cb);
      const overlap = ta.filter((t) => tb.has(t)).length / ta.length;
      // How much of B is new? A retake repeats; a list item adds.
      const novel = cb.length ? cb.filter((t) => !new Set(ta).has(t)).length / cb.length : 0;
      if (novel > 0.5) continue;
      // prefix restart: A's opening words are B's opening words
      const openA = toks(a).slice(0, 3).join(" "), openB = toks(b).slice(0, 3).join(" ");
      if (overlap >= RETAKE_SIM || (openA === openB && ta.length <= 8)) {
        cuts.push({
          start: a.start - PAD, end: b.start - PAD, reason: "retake", review: true,
          text: `"${a.text}"  →  "${b.text}"`, at: a.start, similarity: +overlap.toFixed(2),
        });
        break;
      }
    }
  }

  // flags for the reviewer — never auto-cut
  const TRIGGER = /\b(start (again|over)|let me (re)?do|sorry|cut that|hold on|one sec|scratch that|take two)\b/i;
  for (const s of segs) {
    if (TRIGGER.test(s.text)) flags.push({ at: s.start, reason: "trigger-phrase", text: s.text });
    if (s.no_speech_prob > 0.5 || s.avg_logprob < -0.8) flags.push({ at: s.start, reason: "low-confidence", text: s.text });
  }
  // leading / trailing dead air
  if (words[0].start > 0.6) cuts.push({ start: 0, end: words[0].start - 0.4, reason: "pause", text: "lead-in", at: 0 });

  // A previous review survives a re-propose: manual cuts come back verbatim,
  // and skip/approved decisions on retakes are matched by start time.
  if (existsSync("work/cuts.json")) {
    const prev = JSON.parse(await readFile("work/cuts.json", "utf8"));
    for (const c of prev.cuts) if (c.reason === "manual") cuts.push(c);
    const decided = new Map(prev.cuts.filter((c) => c.review && (c.skip || c.approved)).map((c) => [c.start.toFixed(2), c]));
    for (const c of cuts) {
      const d = c.review && decided.get(c.start.toFixed(2));
      if (d) { c.skip = d.skip; c.approved = d.approved; c.skipReason = d.skipReason; }
    }
  }

  // merge overlapping / touching cuts
  cuts.sort((x, y) => x.start - y.start);
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    // A skipped (vetoed) cut must not be merged into a live one, or the veto
    // silently disappears — keep it as its own entry.
    if (last && c.start <= last.end + 0.02 && !c.skip && !last.skip) {
      last.end = Math.max(last.end, c.end);
      last.reason = last.reason === c.reason ? last.reason : `${last.reason}+${c.reason}`;
      last.text = `${last.text} | ${c.text}`;
      last.review = last.review || c.review;
    } else merged.push({ ...c });
  }
  const removed = merged.reduce((s, c) => s + (c.end - c.start), 0);
  const byReason = {};
  for (const c of merged) byReason[c.reason] = (byReason[c.reason] ?? 0) + 1;

  await mkdir("work", { recursive: true });
  await writeFile("work/cuts.json", JSON.stringify({
    generatedAt: new Date().toISOString(),
    params: { pause: PAUSE, keepPause: KEEP_PAUSE, fillers: FILLERS, retakeSim: RETAKE_SIM },
    summary: { cuts: merged.length, secondsRemoved: +removed.toFixed(2), byReason, needsReview: merged.filter((c) => c.review).length },
    flags,
    cuts: merged.map((c) => ({ ...c, start: +c.start.toFixed(3), end: +c.end.toFixed(3), at: +c.at.toFixed(2) })),
  }, null, 2));

  console.log(`${merged.length} cuts, ${removed.toFixed(1)}s removed of ${words[words.length - 1].end.toFixed(1)}s`);
  console.log(JSON.stringify(byReason));
  if (flags.length) console.log(`${flags.length} flags for review`);
  const rev = merged.filter((c) => c.review);
  if (rev.length) {
    console.log(`\n${rev.length} retake proposals need a human yes (review: true):`);
    for (const c of rev) console.log(`  ${c.start.toFixed(1)}-${c.end.toFixed(1)}  ${c.text.slice(0, 140)}`);
  }
  console.log("\nreview work/cuts.json (delete what you disagree with, add manual cuts), then: node bin/aroll-clean.mjs --apply");
  process.exit(0);
}

// ── apply ─────────────────────────────────────────────────────────────────
const cutsFile = flag("--cuts", "work/cuts.json");
const plan = JSON.parse(await readFile(cutsFile, "utf8"));
const active = plan.cuts
  .filter((c) => !c.skip && !(c.review && !c.approved && !has("--include-unreviewed")))
  .map((c) => ({ start: q(c.start), end: q(c.end) }))
  .sort((a, b) => a.start - b.start);

const total = Number((await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC])).trim());
const keep = [];
let cursor = 0;
for (const c of active) {
  if (c.start > cursor + 1 / FPS) keep.push({ srcStart: cursor, srcEnd: c.start });
  cursor = Math.max(cursor, c.end);
}
if (total - cursor > 1 / FPS) keep.push({ srcStart: cursor, srcEnd: q(total) });
let out = 0;
for (const k of keep) { k.outStart = +out.toFixed(4); out += k.srcEnd - k.srcStart; k.outEnd = +out.toFixed(4); }
const outDur = out;

// Remap the transcript onto the clean timeline: a word whose START sits inside
// a cut is gone; everything else shifts left by the material removed before
// it. A word is kept by its start alone — the PAD around a cut can clip the
// last 30ms of the neighbouring word without removing the word.
const keepOf = (t) => keep.find((k) => t >= k.srcStart - 1e-6 && t <= k.srcEnd + 1e-6);
const cleanWords = [];
for (const w of words) {
  const k = keepOf(w.start);
  if (!k) continue;
  // Whisper emits zero-duration ghost words where it hesitates about a
  // boundary. Harmless mid-phrase, but one sitting exactly on a join is a
  // word whose audio we just cut — it would print a caption for silence.
  if (w.end - w.start < 1e-6 && Math.abs(w.start - k.srcStart) < 0.06) continue;
  const s = k.outStart + (w.start - k.srcStart);
  const e = k.outStart + (Math.min(w.end, k.srcEnd) - k.srcStart);
  cleanWords.push({ text: w.text, start: +s.toFixed(3), end: +Math.max(s, e).toFixed(3) });
}
const KEEP_OUT = `work/keep${SUFFIX}.json`;
const TRANSCRIPT_OUT = `work/transcript.clean${SUFFIX}.json`;
await writeFile(KEEP_OUT, JSON.stringify({ source: SRC, sourceDuration: total, outDuration: +outDur.toFixed(3), keep }, null, 2));
await writeFile(TRANSCRIPT_OUT, JSON.stringify(cleanWords, null, 1));

// ffmpeg filtergraph
await mkdir("out", { recursive: true });
const OUT = flag("--out", "out/01_aroll_clean.mp4");
const vparts = [], aparts = [];
keep.forEach((k, i) => {
  const d = k.srcEnd - k.srcStart;
  vparts.push(`[0:v]trim=start=${k.srcStart}:end=${k.srcEnd},setpts=PTS-STARTPTS[v${i}]`);
  aparts.push(`[0:a]atrim=start=${k.srcStart}:end=${k.srcEnd},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, d - 0.01).toFixed(3)}:d=0.01[a${i}]`);
});
const vin = keep.map((_, i) => `[v${i}]`).join(""), ain = keep.map((_, i) => `[a${i}]`).join("");
const scale = `scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p`;
const graph = [
  ...vparts, ...aparts,
  `${vin}concat=n=${keep.length}:v=1:a=0,${scale}[vout]`,
  `${ain}concat=n=${keep.length}:v=0:a=1,highpass=f=70,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
].join(";\n");
await writeFile("work/aroll-clean.filter", graph);

const nvenc = has("--nvenc");
// Probed against the real source file, so a listed-but-unusable device
// falls back to software instead of taking the render down with it.
const HW = await hwaccelArgs(SRC, { disabled: has("--no-hwaccel") });
const ff = [
  "-y", "-hide_banner", "-loglevel", "warning", "-stats",
  ...HW,
  "-i", SRC,
  "-filter_complex_script", "work/aroll-clean.filter",
  "-map", "[vout]", "-map", "[aout]",
  ...(nvenc
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-g", String(FPS), "-bf", "2"]
    : ["-c:v", "libx264", "-preset", flag("--preset", "medium"), "-crf", flag("--crf", "18"), "-g", String(FPS), "-keyint_min", String(FPS), "-sc_threshold", "0"]),
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
  OUT,
];
console.log(`${keep.length} kept ranges · ${active.length} cuts · ${total.toFixed(1)}s -> ${outDur.toFixed(1)}s (-${(total - outDur).toFixed(1)}s)`);
console.log(`rendering ${OUT} (${nvenc ? "nvenc" : "libx264"}${HW.length ? `, ${HW[1]} decode` : ""}) ...`);
const code = await runInherit("ffmpeg", ff);
if (code !== 0) { console.error(`ffmpeg exited ${code}`); process.exit(code); }
console.log(`wrote ${OUT} + ${KEEP_OUT} + ${TRANSCRIPT_OUT} (${cleanWords.length} words)`);

function runCapture(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv); let o = "";
    p.stdout.on("data", (d) => (o += d)); p.on("close", (c) => (c === 0 ? res(o) : rej(new Error(`${cmd} ${c}`))));
  });
}
function runInherit(cmd, argv) {
  return new Promise((res) => spawn(cmd, argv, { stdio: "inherit" }).on("close", res));
}
