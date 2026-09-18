#!/usr/bin/env node
// Find the moments in a long edit that could stand alone as short-form video,
// and cut each one into its own deliverable.
//
//   node bin/shorts.mjs                      propose -> work/shorts.json, print the list
//   node bin/shorts.mjs --apply              build every accepted moment
//   node bin/shorts.mjs --apply --pick 1,3   build only those
//   node bin/shorts.mjs --min 20 --max 60 --want 5
//
// One edit, several posts. The long cut already has a clean A-roll, a resolved
// transcript, described B-roll and a card on every beat that earns one; a short
// is a WINDOW onto that, not a second edit. So this writes a plan that
// `extends` the vertical one with the out-of-window beats dropped, and the
// phrase anchors inside the window re-resolve against the shortened transcript
// on their own. Nothing is re-planned and nothing can drift.
//
// WHAT IT CAN AND CANNOT JUDGE. It reads the words, the pace and what is
// already on screen. It cannot hear delivery, see a face light up, or know
// which line will land with your audience. It is a shortlist, not a verdict —
// read the text it prints, watch the two or three you like, and throw the rest
// away. The ranking exists to stop you scrubbing a 20-minute timeline, not to
// replace your judgement about what is actually good.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const num = (n, d) => { const v = flag(n, null); return v === null ? d : Number(v); };
const has = (n) => args.includes(n);

const MIN = num("--min", 20);           // under this there is no room for an idea
const MAX = num("--max", 60);           // the band every short-form feed is happy with
const WANT = num("--want", 6);          // a ceiling on how many to propose, not a quota
const FLOOR = num("--floor", 0);        // below this a window is not worth posting
const APPLY = has("--apply");
const PICK = flag("--pick", null);
const PLAN_PATH = flag("--plan", null);

if (!existsSync("project.json")) {
  console.error("No project.json here. Run this from inside projects/<slug>/.");
  process.exit(1);
}
const project = JSON.parse(await readFile("project.json", "utf8"));

// The vertical plan is the right base when it exists: a short is a vertical
// deliverable, and extending the 9:16 cut inherits the crop, the caption size
// and the layout stacking that were decided for that frame.
const BASE_PLAN = PLAN_PATH ?? ["edit-plan.9x16.json", "edit-plan.json"].find((p) => existsSync(p));
if (!BASE_PLAN) { console.error("No edit-plan.json here — write the long edit first."); process.exit(1); }

const loadPlan = async (path, seen = new Set()) => {
  if (seen.has(path)) throw new Error(`plan chain loops back to ${path}`);
  seen.add(path);
  const own = JSON.parse(await readFile(path, "utf8"));
  if (!own.extends) return own;
  const base = await loadPlan(own.extends, seen);
  const { extends: _x, beatOverrides = {}, ...rest } = own;
  const merged = { ...base, ...rest };
  merged.beats = merged.beats
    .map((b) => { const o = beatOverrides[b.id]; return o === undefined ? b : o === null ? null : { ...b, ...o }; })
    .filter(Boolean);
  return merged;
};
const plan = await loadPlan(BASE_PLAN);
const words = JSON.parse(await readFile(plan.transcript ?? "work/transcript.clean.json", "utf8"));
if (!existsSync("work/beats.json")) { console.error("No work/beats.json — run bin/beats.mjs first."); process.exit(1); }
const beats = JSON.parse(await readFile("work/beats.json", "utf8"));

// What is already on screen, if the long cut has been built. Used only to
// prefer moments that already have pictures — never required.
let covered = [];
for (const p of ["build-9x16/plan.resolved.json", "build/plan.resolved.json"]) {
  if (!existsSync(p)) continue;
  const r = JSON.parse(await readFile(p, "utf8"));
  // MERGED, not just collected: a card sitting over a cutaway is two spans on
  // the same seconds, and summing them raw reports 113% of a window covered.
  const raw = [...(r.brolls ?? []), ...(r.cards ?? [])].map((x) => [x.at, x.at + x.dur]).sort((m, n) => m[0] - n[0]);
  for (const [a, b] of raw) {
    const last = covered[covered.length - 1];
    if (last && a <= last[1] + 0.01) last[1] = Math.max(last[1], b);
    else covered.push([a, b]);
  }
  break;
}
const coveredIn = (a, b) => covered.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

// ── what makes an opening worth watching ──────────────────────────────────
// These are patterns of SPEECH, not of writing. A spoken hook is usually a
// question, a number, a contradiction of what the listener expects, or a flat
// claim with a negation in it. None of them guarantee a good short; together
// they sort the first twenty seconds of an idea from the middle of one.
const HOOKS = [
  [/\?/, 3.0, "asks a question"],
  // No "which": it opens a relative clause far more often than a question, so
  // it was scoring "which was inspired by the BlackBerry…" as a hook when it is
  // the middle of somebody's sentence.
  [/^(why|what|how|when|where|who)\b/i, 2.5, "opens on a question word"],
  [/\b(don'?t|doesn'?t|didn'?t|never|no one|nobody|isn'?t|aren'?t|can'?t|won'?t)\b/i, 2.0, "opens on a negation"],
  [/\b(actually|but |instead|the truth|most people|everyone (thinks|assumes)|turns out)\b/i, 2.2, "sets up a contradiction"],
  [/\b(here'?s why|the reason|the problem|the thing is|the point|secret)\b/i, 2.2, "promises an explanation"],
  [/\b(best|worst|biggest|hardest|simplest|only|first|never|always)\b/i, 1.4, "makes an absolute claim"],
  [/\b\d/, 1.2, "opens with a number"],
  [/^(look|listen|imagine|think|picture|try|stop|watch)\b/i, 1.8, "addresses the viewer directly"],
];
// A short that opens on one of these is finishing somebody else's sentence.
const ANAPHORA = /^(it|its|that|this|they|them|those|these|he|she|his|her|which|and|but|so|then|also|because|plus|anyway|too|either)\b/i;
const CLOSERS = /\b(so that'?s|that'?s why|which is why|in the end|that'?s the|and that'?s|so yeah)\b/i;

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const wordsIn = (a, b) => words.filter((w) => w.start >= a - 0.01 && w.end <= b + 0.01);
const textIn = (a, b) => wordsIn(a, b).map((w) => w.text).join(" ");

// The median speaking rate of this video, so pace is judged against the person
// actually talking rather than a number from somewhere else.
const rates = beats.map((b) => b.text.split(/\s+/).length / Math.max(0.1, b.dur)).sort((x, y) => x - y);
const medRate = rates[Math.floor(rates.length / 2)] || 2.5;

function score(startBeat, endBeat) {
  const a = beats[startBeat].start, b = beats[endBeat].end;
  const dur = b - a;
  const text = textIn(a, b);
  if (!text) return null;
  const open = text.split(/\s+/).slice(0, 14).join(" ");
  const why = [];
  let s = 0;

  for (const [re, pts, label] of HOOKS) if (re.test(open)) { s += pts; why.push(label); }

  if (ANAPHORA.test(open)) { s -= 3.5; why.push("OPENS MID-THOUGHT — needs a different first line"); }

  const last = wordsIn(a, b).slice(-1)[0]?.text ?? "";
  if (/[.!?]$/.test(last)) s += 1.2; else { s -= 1.5; why.push("does not end on a finished sentence"); }
  if (CLOSERS.test(text.slice(-90))) { s += 1.0; why.push("lands on a conclusion"); }

  const rate = text.split(/\s+/).length / dur;
  if (rate > medRate * 1.12) { s += 1.2; why.push("faster than his usual pace"); }
  else if (rate < medRate * 0.85) { s -= 0.8; why.push("slower than his usual pace"); }

  const vis = covered.length ? coveredIn(a, b) / dur : 0;
  if (covered.length) {
    if (vis > 0.5) { s += 1.5; why.push(`${(vis * 100).toFixed(0)}% already has B-roll or a card`); }
    else if (vis < 0.15) { s -= 1.0; why.push("almost nothing on screen but the talking head"); }
  }

  // Length: the middle of the band is worth most, the edges are worth less.
  const mid = (MIN + MAX) / 2;
  s += 1.5 * (1 - Math.min(1, Math.abs(dur - mid) / ((MAX - MIN) / 2)));

  return { startBeat, endBeat, start: +a.toFixed(2), end: +b.toFixed(2), dur: +dur.toFixed(1),
           score: +s.toFixed(2), why, text, open };
}

// ── candidates ────────────────────────────────────────────────────────────
// Every run of whole beats that lands in the band. Beats already break on
// terminal punctuation or a pause, so a window built from them starts and ends
// where the speaker did — which is most of what "self-contained" means.
const cands = [];
for (let i = 0; i < beats.length; i++) {
  for (let j = i; j < beats.length; j++) {
    const dur = beats[j].end - beats[i].start;
    if (dur < MIN) continue;
    if (dur > MAX) break;
    const c = score(i, j);
    if (c) cands.push(c);
  }
}
if (!cands.length) {
  console.error(`No stretch of this edit fits between ${MIN}s and ${MAX}s. Try --min/--max.`);
  process.exit(1);
}
cands.sort((x, y) => y.score - x.score);

// Greedy non-overlapping pick: the best moment, then the best that does not
// reuse its words, and so on. Two shorts sharing a sentence are one short
// posted twice.
//
// --want is a ceiling, never a quota. Padding the list to six with windows
// that open mid-sentence and trail off would hand back a confident-looking
// ranking of things nobody should post; a video that only has two good moments
// should say two.
const picked = [];
for (const c of cands) {
  if (picked.length >= WANT) break;
  if (c.score < FLOOR) continue;
  if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
  picked.push(c);
}
if (!picked.length) {
  console.log(`\nNothing in this edit clears the bar (best score ${cands[0].score.toFixed(1)}, floor ${FLOOR}).`);
  console.log(`It is a continuous argument rather than a set of separable moments — which is a`);
  console.log(`real answer, not a failure. Lower it with --floor if you want to see the list anyway.\n`);
  process.exit(0);
}
picked.sort((x, y) => x.start - y.start);
picked.forEach((p, i) => { p.n = i + 1; p.slug = `short-${String(i + 1).padStart(2, "0")}`; });

await mkdir("work", { recursive: true });
await writeFile("work/shorts.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  basePlan: BASE_PLAN, min: MIN, max: MAX,
  note: "Ranked by text, pace and existing visuals. It cannot hear delivery — read these and pick.",
  shorts: picked,
}, null, 2));

console.log(`\n${cands.length} windows considered · ${picked.length} proposed · base plan ${BASE_PLAN}\n`);
for (const p of picked) {
  console.log(`${String(p.n).padStart(2)}. ${mmss(p.start)}–${mmss(p.end)}  ${String(p.dur).padStart(5)}s  score ${p.score.toFixed(1)}`);
  console.log(`    "${p.open}${p.text.length > p.open.length ? "…" : ""}"`);
  if (p.why.length) console.log(`    ${p.why.join(" · ")}`);
  console.log("");
}
console.log("These are a shortlist, not a verdict — it reads words and pacing, it cannot hear");
console.log("delivery. Read them, then build the ones you actually want:\n");
console.log(`  node ../../bin/shorts.mjs --apply --pick ${picked.map((p) => p.n).join(",")}\n`);

if (!APPLY) process.exit(0);

// ── build ─────────────────────────────────────────────────────────────────
const wanted = PICK ? new Set(PICK.split(",").map((x) => Number(x.trim()))) : null;
const todo = picked.filter((p) => !wanted || wanted.has(p.n));
if (!todo.length) { console.error(`--pick ${PICK} matched none of 1..${picked.length}`); process.exit(1); }

const SRC = plan.aroll;
if (!existsSync(SRC)) { console.error(`\n${SRC} is missing — render the clean A-roll first.`); process.exit(1); }
await mkdir("out", { recursive: true });

for (const p of todo) {
  const arollOut = `out/01_aroll_${p.slug}.mp4`;
  const txOut = `work/transcript.clean.${p.slug}.json`;
  const planOut = `edit-plan.${p.slug}.json`;

  process.stdout.write(`${p.slug}  cutting ${mmss(p.start)}–${mmss(p.end)} ... `);
  // Cut against end-start, NOT the printed `dur`: that one is rounded to a
  // tenth for the report, and a 50 ms shortfall clips the last word's audio
  // while the caption still shows it.
  const cutDur = +(p.end - p.start).toFixed(3);
  // -ss before -i seeks fast; because we re-encode, ffmpeg still discards the
  // frames before `start`, so the output begins exactly on the window and the
  // rebased transcript below lines up with it.
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(p.start), "-i", SRC, "-t", String(cutDur),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", arollOut], { maxBuffer: 1 << 24 });

  // The transcript is what every phrase anchor resolves against, so it has to
  // be the window's words with the window's own clock.
  const sliced = wordsIn(p.start, p.end).map((w) => ({
    text: w.text, start: +(w.start - p.start).toFixed(3), end: +(w.end - p.start).toFixed(3),
  }));
  await writeFile(txOut, JSON.stringify(sliced, null, 1));

  // Beats outside the window are dropped with `null`; an unresolved phrase
  // anchor would otherwise fall back to 0 and pile every stray card on the
  // first frame. Beats inside are rebased — their numeric bounds are in the
  // long cut's clock, their phrase anchors re-resolve on their own.
  const overrides = {};
  let kept = 0;
  for (const b of plan.beats) {
    const inside = b.start !== undefined && b.end !== undefined
      && b.start >= p.start - 0.25 && b.end <= p.end + 0.25;
    if (inside) { overrides[b.id] = { start: +(b.start - p.start).toFixed(2), end: +(b.end - p.start).toFixed(2) }; kept++; }
    else overrides[b.id] = null;
  }

  await writeFile(planOut, JSON.stringify({
    _readme: [
      `${project.name} — short ${p.n}, ${mmss(p.start)}–${mmss(p.end)} of the long cut (${p.dur}s).`,
      "",
      `Proposed by bin/shorts.mjs because it ${p.why.join(", ") || "fits the length band"}.`,
      "",
      "This is a WINDOW on the long edit, not a second edit. It extends the",
      `vertical plan, so the crop, captions and card layouts are the ones already`,
      "decided for 9:16. beatOverrides drops every beat outside the window and",
      "rebases the ones inside; their spoken anchors re-resolve against the",
      "shortened transcript on their own.",
      "",
      "Re-running bin/shorts.mjs OVERWRITES this file. Anything you want to keep",
      "-- a different in point, an extra card, a changed hook -- rename the plan",
      "first and edit the copy.",
      "",
      `Opening line: "${p.open}"`,
    ],
    extends: BASE_PLAN,
    aroll: arollOut,
    transcript: txOut,
    outDir: `build-${p.slug}`,
    beatOverrides: overrides,
  }, null, 2) + "\n");

  console.log(`ok — ${kept} of ${plan.beats.length} beats kept`);
}

const comp = project.composition?.height > project.composition?.width ? "" : " --composition 1080x1920";
console.log(`\nBuilt ${todo.length} short${todo.length === 1 ? "" : "s"}. Now look at them:\n`);
for (const p of todo) console.log(`  node ../../bin/build-edit.mjs --plan edit-plan.${p.slug}.json${comp}`);
console.log(`\nThen render the ones that hold up:\n`);
for (const p of todo) console.log(`  PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build-${p.slug} -o out/${p.slug}.mp4 --fps 30`);
console.log("");
