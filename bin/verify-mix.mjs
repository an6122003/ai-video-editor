#!/usr/bin/env node
// Does the music cover the voice? Measure it, do not assume it.
//
//   node bin/verify-mix.mjs --video out/02_edit.mp4 --music "…/Cosy - Dyalla.mp3"
//        [--music-db -6] [--duck-ratio 4] [--transcript work/transcript.clean.json]
//        [--min-sep 10] [--max-sep 20]
//
// The mixer ducks the bed with sidechaincompress, which is derived from the
// voice rather than keyframed — so the only way to know what it actually did is
// to rebuild the bed from bin/lib/bed.mjs and measure it against the voice in
// the windows where he is speaking.
//
// Method
//   speech windows  union of the word intervals from the clean transcript,
//                   gaps under 0.25s merged, windows under 0.8s dropped
//   pause windows   the complement, 1.2s or longer, edges trimmed, and never
//                   inside the outro fade — a "pause" in the fade measures the
//                   fade, which once made the duck read as exactly 0.0 LU
//   Then, over the speech windows: the voice, the bed as built, and the bed
//   with the duck bypassed. loudnorm and the limiter act on the sum, so they
//   move both stems together and the separation between them survives.
//
// Passing means: while he speaks the voice sits --min-sep LU or more above the
// bed, and not so far above that the music is inaudible. Broadcast practice for
// a bed under narration is 6-12 LU; a talking-head explainer wants the top of
// that, and past about 20 LU there is no point having music at all.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bedGraph, duckGraph, copiesFor, usableBody, DUCK } from "./lib/bed.mjs";
const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VIDEO = flag("--video");
const MUSIC = flag("--music", null);
const MUSIC_DB = Number(flag("--music-db", -6));
const DUCK_RATIO = Number(flag("--duck-ratio", DUCK.ratio));
const XFADE = Number(flag("--loop-xfade", 6));
const TRANSCRIPT = flag("--transcript", "work/transcript.clean.json");
const MIN_SEP = Number(flag("--min-sep", 10));
const MAX_SEP = Number(flag("--max-sep", 20));
const TMP = flag("--tmp", process.env.TEMP || ".");
if (!VIDEO || !existsSync(VIDEO)) { console.error("--video <rendered mp4> is required"); process.exit(1); }
if (!existsSync(TRANSCRIPT)) { console.error(`transcript not found: ${TRANSCRIPT}`); process.exit(1); }

const dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", VIDEO])).stdout.trim());
const words = JSON.parse(await readFile(TRANSCRIPT, "utf8"));

// ── windows ──────────────────────────────────────────────────────────────
const MERGE = 0.25, MIN_SPEECH = 0.8, MIN_PAUSE = 1.2, TRIM = 0.2, FADE_TAIL = 3.5;
const speech = [];
for (const w of words) {
  const s = +w.start, e = +w.end;
  if (!(e > s)) continue;                            // ghost words carry zero length
  const last = speech[speech.length - 1];
  if (last && s - last[1] <= MERGE) last[1] = Math.max(last[1], e);
  else speech.push([s, e]);
}
const speechKept = speech.filter(([s, e]) => e - s >= MIN_SPEECH);
const pause = [];
let cursor = 0;
for (const [s, e] of speech) {
  if (s - cursor >= MIN_PAUSE) pause.push([cursor + TRIM, s - TRIM]);
  cursor = Math.max(cursor, e);
}
// The bed fades out over the last 3s. A window in there measures the fade, not
// the bed, so stop short of it.
if (dur - FADE_TAIL - cursor >= MIN_PAUSE) pause.push([cursor + TRIM, dur - FADE_TAIL]);

const secs = (ws) => ws.reduce((a, [s, e]) => a + (e - s), 0);
if (!speechKept.length) { console.error("no speech windows — is the transcript on this file's timeline?"); process.exit(1); }

const sel = (ws) => ws.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join("+");

// ── stems ────────────────────────────────────────────────────────────────
const voiceWav = `${TMP}/vm-voice.wav`, duckedWav = `${TMP}/vm-bed.wav`, rawWav = `${TMP}/vm-bed-raw.wav`;
await run("ffmpeg", ["-y", "-v", "error", "-i", VIDEO,
  "-map", "0:a:0", "-af", "aformat=sample_rates=48000:channel_layouts=stereo", "-c:a", "pcm_s16le", voiceWav]);

let haveBed = false, copies = 1, body = null;
if (MUSIC && existsSync(MUSIC)) {
  body = await usableBody(MUSIC);
  copies = copiesFor(dur, body.out - body.in, XFADE);

  // The bed the mixer builds, from the same module, so this measures the mix
  // that actually ships. Input 0 is the video (the duck's sidechain), then one
  // input per loop pass.
  const ins = ["-i", VIDEO];
  for (let k = 0; k < copies; k++) ins.push("-i", MUSIC);
  const g = [
    "[0:a]aformat=sample_rates=48000:channel_layouts=stereo[sc]",
    ...bedGraph({ firstInput: 1, copies, dur, musicDb: MUSIC_DB, xfade: XFADE, body }),
    duckGraph("bed", "sc", "out", { ratio: DUCK_RATIO }),
  ].join(";");
  await run("ffmpeg", ["-y", "-v", "error", ...ins, "-filter_complex", g,
    "-map", "[out]", "-t", dur.toFixed(3), "-c:a", "pcm_s16le", duckedWav], { maxBuffer: 1 << 26 });

  // The same bed with the duck bypassed. Comparing the two over the speech
  // windows measures the gain reduction directly — the only way to see it on a
  // video that is 96% speech and has no usable pauses to compare against.
  const insRaw = [];
  for (let k = 0; k < copies; k++) insRaw.push("-i", MUSIC);
  const gRaw = bedGraph({ firstInput: 0, copies, dur, musicDb: MUSIC_DB, xfade: XFADE, body }).join(";");
  await run("ffmpeg", ["-y", "-v", "error", ...insRaw, "-filter_complex", gRaw,
    "-map", "[bed]", "-t", dur.toFixed(3), "-c:a", "pcm_s16le", rawWav], { maxBuffer: 1 << 26 });
  haveBed = true;
}

// ── measure ──────────────────────────────────────────────────────────────
const measure = async (file, windows) => {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file,
    "-af", `aselect='${sel(windows)}',asetpts=N/SR/TB,ebur128=peak=true:framelog=quiet`,
    "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const tail = stderr.slice(stderr.lastIndexOf("Summary"));
  const g = (re) => { const m = tail.match(re); return m ? Number(m[1]) : NaN; };
  return { i: g(/I:\s+(-?[\d.]+) LUFS/), lra: g(/LRA:\s+(-?[\d.]+) LU/), peak: g(/Peak:\s+(-?[\d.]+) dBFS/) };
};

const vS = await measure(voiceWav, speechKept);
const bS = haveBed ? await measure(duckedWav, speechKept) : null;
const rS = haveBed ? await measure(rawWav, speechKept) : null;
const bP = haveBed && pause.length ? await measure(duckedWav, pause) : null;

// ── report ───────────────────────────────────────────────────────────────
const f = (n, u = "") => (Number.isFinite(n) ? n.toFixed(1) + u : "n/a");
console.log(`\n${VIDEO}  ${dur.toFixed(1)}s`);
console.log(`  speech  ${speechKept.length} windows, ${secs(speechKept).toFixed(0)}s (${((secs(speechKept) / dur) * 100).toFixed(0)}% of the video)`);
console.log(`  pauses  ${pause.length} windows, ${secs(pause).toFixed(0)}s`);
console.log(`\n  voice, while speaking      ${f(vS.i, " LUFS")}   (LRA ${f(vS.lra)} LU, peak ${f(vS.peak)} dBFS)`);
if (!haveBed) { console.log(`\n  no music given — nothing to cover the voice.`); process.exit(0); }
console.log(`  music, undacked            ${f(rS.i, " LUFS")}   the bed at ${MUSIC_DB}dB` +
  `${body?.trimmed ? `, body ${body.in.toFixed(0)}-${body.out.toFixed(0)}s` : ""}${copies > 1 ? `, ${copies} passes crossfaded` : ""}`);
console.log(`  music, while he speaks     ${f(bS.i, " LUFS")}   after the ${DUCK_RATIO}:1 duck`);
if (bP) console.log(`  music, in the pauses       ${f(bP.i, " LUFS")}   over ${secs(pause).toFixed(0)}s of real silence`);

const sep = vS.i - bS.i;
const duck = rS ? rS.i - bS.i : NaN;
console.log(`\n  separation over speech     ${sep.toFixed(1)} LU        (want ${MIN_SEP}-${MAX_SEP})`);
if (Number.isFinite(duck)) console.log(`  gain reduction             ${duck.toFixed(1)} LU        (how far the duck pulls the bed down)`);

const notes = [];
const dbFor = (target) => (MUSIC_DB - (target - sep)).toFixed(0);
if (sep < MIN_SEP) notes.push(`the music is too loud under the voice: ${sep.toFixed(1)} LU, wanted ${MIN_SEP}. Try --music-db ${dbFor(MIN_SEP + 2)}.`);
if (sep > MAX_SEP) notes.push(`the bed is so far down it will not be heard: ${sep.toFixed(1)} LU. Try --music-db ${dbFor(MAX_SEP - 4)}.`);
if (Number.isFinite(duck) && duck < 2) notes.push(`the duck is barely working (${duck.toFixed(1)} LU) — the bed sits at one level throughout.`);
if (Number.isFinite(duck) && duck > 9) notes.push(`the duck is clamped on (${duck.toFixed(1)} LU across ${((secs(speechKept) / dur) * 100).toFixed(0)}% speech) — lower --duck-ratio and set the level with --music-db instead.`);
console.log("");
if (notes.length) { for (const n of notes) console.log(`  ! ${n}`); process.exit(1); }
console.log(`  PASS — the voice sits ${sep.toFixed(1)} LU over the bed while he speaks, and the duck moves it ${duck.toFixed(1)} LU.`);
