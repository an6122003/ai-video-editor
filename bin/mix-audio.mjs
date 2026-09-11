#!/usr/bin/env node
// Final audio mix: dialogue stays dominant, music ducks under speech, sound
// effects land on their cues, the whole thing normalised for YouTube.
//
//   node bin/mix-audio.mjs --video out/render.mp4 --out out/final.mp4
//        [--music music/bed.mp3] [--music-db -6] [--duck-ratio 4]
//        [--sfx sfx-cues.json] [--lufs -14] [--loop-xfade 6]
//
// The bed comes from bin/lib/bed.mjs: the track's playing body (its fade-out
// trimmed off), looped as many times as the video needs, seams crossfaded, then
// side-chain compressed against the dialogue so it sits under speech and comes
// back up in the gaps on its own. sfx-cues.json is [{ "at": 12.4, "file":
// "sfx/whoosh.wav", "db": -8 }] — one entry per cue, placed with adelay.
//
// Why a separate pass instead of mixing inside the composition: the renderer
// mixes <audio> elements at fixed data-volume, so ducking would have to be
// hand-keyed; ffmpeg's sidechaincompress derives it from the voice itself.
//
// SET THE LEVEL AGAINST A MEASUREMENT, not by ear-guessing a number:
//   node bin/verify-mix.mjs --video <render> --music <mp3> --music-db -6
// wants 10-20 LU between the voice and the ducked bed. -6dB lands ep.01 at 12,
// which is audible; -9dB lands it at 15, which turned out to be so far under
// that it read as no music at all.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bedGraph, duckGraph, copiesFor, usableBody, DUCK } from "./lib/bed.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const VIDEO = flag("--video");
const OUT = flag("--out", "out/final.mp4");
const MUSIC = flag("--music", null);
const MUSIC_DB = Number(flag("--music-db", -6));   // verified, not guessed — see the header
const LUFS = Number(flag("--lufs", -14));
const SFX = flag("--sfx", null);
const XFADE = Number(flag("--loop-xfade", 6));
const DUCK_RATIO = Number(flag("--duck-ratio", DUCK.ratio));
if (!VIDEO || !existsSync(VIDEO)) { console.error("--video <rendered.mp4> is required"); process.exit(1); }

const dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", VIDEO])).stdout.trim());
// The cue sounds live once at the repo root and are shared by every project,
// so "sfx/whoosh.wav" resolves against the project first and the repo second.
//
// A missing cue used to be dropped in silence by a .filter(existsSync), which
// is how 122 placed cues across four episodes produced no sound at all without
// anyone noticing. Say it out loud instead: a cue that cannot be found is a
// defect in the edit, not a preference.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cueFile = (f) => (existsSync(f) ? f : existsSync(join(REPO, f)) ? join(REPO, f) : null);
const cues = [];
if (SFX && existsSync(SFX)) {
  const missing = new Map();
  for (const c of JSON.parse(await readFile(SFX, "utf8"))) {
    const found = cueFile(c.file);
    if (found) cues.push({ ...c, file: found });
    else missing.set(c.file, (missing.get(c.file) ?? 0) + 1);
  }
  for (const [f, n] of missing)
    console.warn(`  WARNING: ${n} cue${n === 1 ? "" : "s"} reference ${f}, which is not in the project or at ${REPO} — those cues will be silent`);
}

const inputs = ["-i", VIDEO];
let loopNote = "";
const graph = [];
let idx = 1;
const mixIns = ["[voice]"];

graph.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][sc]`);

if (MUSIC && existsSync(MUSIC)) {
  // The track's playing body, looped enough times to cover the video with the
  // seams crossfaded — a library track's own fade-out would otherwise leave a
  // hole in the middle of the edit. See lib/bed.mjs.
  const body = await usableBody(MUSIC);
  const bodyDur = body.out - body.in;
  const copies = copiesFor(dur, bodyDur, XFADE);
  for (let k = 0; k < copies; k++) inputs.push("-i", MUSIC);
  graph.push(...bedGraph({ firstInput: idx, copies, dur, musicDb: MUSIC_DB, xfade: XFADE, body }));
  graph.push(duckGraph("bed", "sc", "ducked", { ratio: DUCK_RATIO }));
  mixIns.push("[ducked]");
  loopNote = (body.trimmed ? `, body ${body.in.toFixed(0)}-${body.out.toFixed(0)}s of ${body.dur.toFixed(0)}s` : "") +
    (copies > 1 ? `, ${copies} passes crossfaded ${XFADE}s` : "");
  idx += copies;
} else {
  graph.push(`[sc]anullsink`);
}

// A cue's `at` is when the sound should HIT, not when its file should start
// playing. Those are the same thing only for a sound whose peak is its first
// sample. They are not the same for a whoosh, which swells: whoosh.wav peaks
// 236 ms in, so starting it on a cut puts its loudest moment a quarter of a
// second behind the picture. So each file is pulled forward by its own peak
// offset, measured once here. --no-align-peaks restores raw file-start
// placement.
const ALIGN = !args.includes("--no-align-peaks");
const peakCache = new Map();
const peakOffset = async (f) => {
  if (!ALIGN) return 0;
  if (peakCache.has(f)) return peakCache.get(f);
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "48000",
    "-f", "f32le", "-"], { maxBuffer: 1 << 26, encoding: "buffer" });
  const b = Buffer.from(stdout);
  const s = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
  let peak = 0, at = 0;
  for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) { peak = a; at = i; } }
  const off = at / 48000;
  peakCache.set(f, off);
  return off;
};

const aligned = [];
for (const c of cues) {
  const off = await peakOffset(c.file);
  inputs.push("-i", c.file);
  const ms = Math.max(0, Math.round((c.at - off) * 1000));
  if (off >= 0.02) aligned.push(`${c.file.split(/[\\/]/).pop()} -${(off * 1000).toFixed(0)}ms`);
  graph.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.db ?? -6}dB,adelay=${ms}|${ms}[sfx${idx}]`);
  mixIns.push(`[sfx${idx}]`);
  idx++;
}
if (aligned.length) console.log(`  peak-aligned: ${[...new Set(aligned)].join(", ")}`);

const MIXED = `${mixIns.join("")}amix=inputs=${mixIns.length}:duration=first:dropout_transition=0:normalize=0`;

// loudnorm in one pass applies a gain that varies over time, which would keep
// the programme at -14 on average while quietly modulating the balance between
// the voice and the bed. Two passes with linear=true apply one static gain
// instead, so the separation verify-mix.mjs measures is the separation that
// ships. alimiter needs level=disabled or it auto-normalises the result back
// toward 0 dBFS and undoes all of this.
const norm = (extra = "") =>
  `${MIXED},loudnorm=I=${LUFS}:TP=-1.5:LRA=11${extra},alimiter=limit=0.891:level=disabled[aout]`;

console.log(`mixing ${VIDEO} (${dur.toFixed(1)}s)` + (MUSIC ? ` + music ${MUSIC} @ ${MUSIC_DB}dB, ducked${loopNote}` : " (no music)") + (cues.length ? ` + ${cues.length} sfx cues` : "") + ` -> ${OUT}`);

process.stdout.write("  pass 1/2 measuring ... ");
const measured = await (async () => {
  const g = [...graph, `${MIXED},loudnorm=I=${LUFS}:TP=-1.5:LRA=11:print_format=json[aout]`].join(";");
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-v", "info", ...inputs,
    "-filter_complex", g, "-map", "[aout]", "-f", "null", "-"], { maxBuffer: 1 << 28 }).catch((e) => ({ stderr: e.stderr ?? "" }));
  const j = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  try { return JSON.parse(j); } catch { return null; }
})();

let extra = "";
if (measured?.input_i) {
  extra = `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true`;
  console.log(`in ${Number(measured.input_i).toFixed(1)} LUFS / ${Number(measured.input_tp).toFixed(1)} dBTP -> one static gain`);
} else {
  console.log("could not read the measurement; falling back to single-pass loudnorm");
}

graph.push(norm(extra));
const ff = ["-y", "-hide_banner", "-loglevel", "warning", "-stats", ...inputs,
  "-filter_complex", graph.join(";"),
  "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUT];
console.log("  pass 2/2 writing");
const code = await new Promise((res) => spawn("ffmpeg", ff, { stdio: "inherit" }).on("close", res));
if (code !== 0) { console.error(`ffmpeg exited ${code}`); process.exit(code); }
console.log(`wrote ${OUT}`);
