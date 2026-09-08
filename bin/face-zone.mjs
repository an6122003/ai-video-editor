#!/usr/bin/env node
// Measures where the talker's face actually is, so graphics can avoid it.
//
//   node face-zone.mjs build/input-video.mp4 [everySeconds]
//
// Samples frames, runs macOS Vision face detection on each, and writes
// face-zone.json: the face band in 1080x1920 stage pixels plus per-sample boxes.
// The band uses PERCENTILES, not the union — one frame where he leans out of
// shot should not push the safe area for the whole video.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const SRC = process.argv[2] ?? "build/input-video.mp4";
const EVERY = Number(process.argv[3] ?? 4);
const W = 1080, H = 1920;
const HERE = dirname(fileURLToPath(import.meta.url));

const { stdout: probe } = await run("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC,
]);
const dur = parseFloat(probe.trim());
const times = [];
for (let t = 1; t < dur; t += EVERY) times.push(+t.toFixed(2));

const dir = await mkdtemp(join(tmpdir(), "facez-"));
for (const t of times) {
  await run("ffmpeg", ["-v", "error", "-ss", String(t), "-i", SRC,
    "-frames:v", "1", "-vf", `scale=${W}:${H}`, join(dir, `f-${t}.jpg`), "-y"]);
}
const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).map((f) => join(dir, f));

// swift runs the script directly; it JIT-compiles once per invocation, so all
// frames go through in a single call rather than one process per frame.
const { stdout } = await run("swift", [join(HERE, "face-detect.swift"), ...files], {
  maxBuffer: 32 * 1024 * 1024,
});
const results = JSON.parse(stdout);
await rm(dir, { recursive: true, force: true });

const samples = [];
for (const r of results) {
  const t = parseFloat(r.file.match(/f-([\d.]+)\.jpg$/)?.[1] ?? "0");
  // Largest face per frame — the talker, not someone in a poster behind him.
  const f = r.faces.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!f) { samples.push({ t, face: null }); continue; }
  samples.push({
    t,
    face: {
      left: Math.round(f.x * W), top: Math.round(f.y * H),
      right: Math.round((f.x + f.w) * W), bottom: Math.round((f.y + f.h) * H),
    },
  });
}

const found = samples.filter((s) => s.face);
if (!found.length) {
  console.error("No faces detected — leaving face-zone.json unwritten.");
  process.exit(1);
}
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)];
const zone = {
  // 10th percentile top / 90th bottom: covers most frames without letting one
  // outlier lean define the whole safe area.
  top: pct(found.map((s) => s.face.top), 0.1),
  bottom: pct(found.map((s) => s.face.bottom), 0.9),
  left: pct(found.map((s) => s.face.left), 0.1),
  right: pct(found.map((s) => s.face.right), 0.9),
  detectedIn: `${found.length}/${samples.length} samples`,
  everySeconds: EVERY,
};
await writeFile("face-zone.json", JSON.stringify({ zone, samples }, null, 2));
console.log(`face zone  top=${zone.top} bottom=${zone.bottom} left=${zone.left} right=${zone.right}`);
console.log(`detected in ${zone.detectedIn}; clear above ${zone.top}px and below ${zone.bottom}px`);
