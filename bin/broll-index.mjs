#!/usr/bin/env node
// Indexes a folder of B-roll for the director: one timestamped contact sheet
// per ~16 tiles of footage, so a vision pass (the agent, or a VLM) can read the
// temporal progression of each clip and mark it into segments.
//
//   node bin/broll-index.mjs <folder> --out <project>/broll [--tile-sec 5] [--force]
//
// Writes:
//   <out>/sheets/<clip>-<n>.jpg   4x4 tiles, each stamped with its source time
//   <out>/index.json              per-clip metadata + sheet/tile map + empty
//                                 `segments` for the describe step to fill
//   <out>/DESCRIBE.md             the worklist: which sheets to read, and the
//                                 segment schema to write back
//
// Sampling is UNIFORM, not scene-cut driven: this footage is continuous
// handheld takes where the subject changes gradually (a pan from one station
// to the next), so cut detection finds nothing and the interesting boundaries
// only exist in the describer's reading. A tile every `tileSec` seconds gives
// the reader enough frames to place a boundary to within a few seconds, which
// is all placement needs — the director picks a window inside a segment, not a
// frame.
//
// Frames are pulled in ONE decode pass per clip (fps filter), hardware-decoded
// when the ffmpeg build has CUDA, because per-frame `-ss` seeks re-decode from
// the previous keyframe every time and 4K makes that expensive.
import { readdir, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, basename, resolve } from "node:path";

const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const FOLDER = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const OUT = resolve(flag("--out", "broll"));
const TILE_SEC = Number(flag("--tile-sec", 5));
const FORCE = args.includes("--force");
const COLS = 4, ROWS = 4, PER_SHEET = COLS * ROWS;
const TILE_W = 480; // 4 tiles = 1920 wide sheet; enough to read hands and parts

if (!FOLDER || !existsSync(FOLDER)) {
  console.error("usage: node bin/broll-index.mjs <folder> --out <dir> [--tile-sec 5] [--force]");
  process.exit(1);
}

const VID = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);

// ASCII slug that survives Vietnamese filenames: strip combining marks, map đ.
const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

// DJI names carry the capture time: DJI_20260805093900_0004_D → 2026-08-05T09:39:00.
// Capture order is how the reader reconstructs a sequence (grab → fit → close
// → test) that was shot across several clips.
const shotAt = (name, mtime) => {
  const m = /DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return mtime.toISOString().slice(0, 19);
};

async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-show_entries", "format=duration",
    "-of", "json", file,
  ]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] ?? {};
  const [n, d] = (s.r_frame_rate ?? "30/1").split("/").map(Number);
  return { width: s.width, height: s.height, fps: +(n / d).toFixed(3), duration: +(+j.format.duration).toFixed(3) };
}

let HWACCEL = null;
async function detectHwaccel(sample) {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-hwaccels"]);
    if (!/cuda/.test(stdout)) return null;
    await run("ffmpeg", ["-v", "error", "-hwaccel", "cuda", "-t", "0.5", "-i", sample, "-f", "null", "-"]);
    return "cuda";
  } catch {
    return null;
  }
}

// Sheet render: decode once, keep a frame every TILE_SEC, stamp the source
// time, tile 4x4. drawtext runs after fps so %{pts} is the kept frame's time,
// not the decode clock.
async function renderSheets(clip, outDir) {
  const nTiles = Math.max(1, Math.ceil(clip.duration / TILE_SEC));
  const nSheets = Math.ceil(nTiles / PER_SHEET);
  const pattern = join(outDir, `${clip.id}-%02d.jpg`);
  const exists = Array.from({ length: nSheets }, (_, i) => join(outDir, `${clip.id}-${String(i + 1).padStart(2, "0")}.jpg`));
  if (!FORCE && exists.every((p) => existsSync(p))) return { nTiles, nSheets, cached: true };

  const vf = [
    `fps=1/${TILE_SEC}`,
    `scale=${TILE_W}:-2`,
    // Escape for drawtext: the colon in %{pts:hms} is a filter option separator.
    `drawtext=text='%{pts\\:hms}':fontcolor=white:fontsize=26:box=1:boxcolor=black@0.6:boxborderw=5:x=6:y=6`,
    `tile=${COLS}x${ROWS}:padding=3:margin=0:color=black`,
  ].join(",");
  const argv = ["-v", "error", "-y", "-loglevel", "error"];
  if (HWACCEL) argv.push("-hwaccel", HWACCEL);
  argv.push("-i", clip.path, "-vf", vf, "-q:v", "3", "-start_number", "1", pattern);
  await run("ffmpeg", argv, { maxBuffer: 16 * 1024 * 1024 });
  return { nTiles, nSheets, cached: false };
}

const entries = (await readdir(FOLDER, { withFileTypes: true }))
  .filter((e) => e.isFile() && VID.has(extname(e.name).toLowerCase()))
  .map((e) => e.name)
  .sort();

if (!entries.length) {
  console.error(`no video files in ${FOLDER}`);
  process.exit(1);
}

await mkdir(join(OUT, "sheets"), { recursive: true });
HWACCEL = await detectHwaccel(join(FOLDER, entries[0]));
console.log(`${entries.length} clips  tile every ${TILE_SEC}s  decode=${HWACCEL ?? "software"}  -> ${OUT}`);

// Preserve any descriptions already written: re-running the indexer after
// adding clips must not throw away the describe pass.
const prevPath = join(OUT, "index.json");
const prev = existsSync(prevPath) ? JSON.parse(await readFile(prevPath, "utf8")) : null;
const prevById = new Map((prev?.clips ?? []).map((c) => [c.id, c]));

// The describe pass writes `<out>/described/*.json`, each `{ <clipId>: [segments] }`,
// one file per batch of sheets read. Re-running the indexer folds them in, so
// describing is append-only and never edits index.json by hand.
const described = new Map();
const descDir = join(OUT, "described");
if (existsSync(descDir)) {
  for (const f of (await readdir(descDir)).filter((f) => f.endsWith(".json")).sort()) {
    const batch = JSON.parse(await readFile(join(descDir, f), "utf8"));
    for (const [id, segs] of Object.entries(batch)) described.set(id, segs);
  }
}

const clips = [];
let totalDur = 0, totalSheets = 0;
for (const name of entries) {
  const path = join(FOLDER, name);
  const st = await stat(path);
  const meta = await probe(path);
  const clip = { id: slug(name), file: name, path, shotAt: shotAt(name, st.mtime), ...meta };
  const t0 = Date.now();
  const { nTiles, nSheets, cached } = await renderSheets(clip, join(OUT, "sheets"));
  clip.sheets = Array.from({ length: nSheets }, (_, s) => {
    const first = s * PER_SHEET;
    const count = Math.min(PER_SHEET, nTiles - first);
    return {
      file: `sheets/${clip.id}-${String(s + 1).padStart(2, "0")}.jpg`,
      // Tile k (row-major) shows source time k*TILE_SEC within this sheet.
      tiles: Array.from({ length: count }, (_, k) => ({
        n: k + 1,
        t: +((first + k) * TILE_SEC).toFixed(2),
      })),
      covers: [+(first * TILE_SEC).toFixed(2), +Math.min(clip.duration, (first + count) * TILE_SEC).toFixed(2)],
    };
  });
  clip.segments = described.get(clip.id) ?? prevById.get(clip.id)?.segments ?? [];
  clip.described = clip.segments.length > 0;
  clips.push(clip);
  totalDur += clip.duration;
  totalSheets += nSheets;
  console.log(
    `  ${clip.id.padEnd(34)} ${String(clip.duration.toFixed(1)).padStart(6)}s  ${nTiles} tiles / ${nSheets} sheet${nSheets > 1 ? "s" : ""}` +
      (cached ? "  (cached)" : `  ${((Date.now() - t0) / 1000).toFixed(1)}s`),
  );
}

// Capture order, so a reader going through the worklist sees the day unfold.
clips.sort((a, b) => a.shotAt.localeCompare(b.shotAt));

const index = {
  generatedAt: new Date().toISOString(),
  source: resolve(FOLDER),
  tileSec: TILE_SEC,
  sheet: { cols: COLS, rows: ROWS, tileWidth: TILE_W },
  totals: { clips: clips.length, seconds: +totalDur.toFixed(1), sheets: totalSheets },
  clips,
};
await writeFile(prevPath, JSON.stringify(index, null, 2));

const todo = clips.filter((c) => !c.described);
const md = `# B-roll describe worklist

${clips.length} clips · ${(totalDur / 60).toFixed(1)} min · ${totalSheets} sheets · ${todo.length} clips still undescribed.

Read each sheet (4×4, row-major, each tile stamped with its source time) and
write the clip's \`segments\` into \`index.json\`. A segment is a stretch where
the same thing is happening — the boundaries are where the reader sees the
subject, station or action change. Schema per segment:

\`\`\`jsonc
{
  "start": 0,   "end": 28,          // seconds, from the tile stamps
  "action": "worker fits speaker module into device shell on assembly tray",
  "subject": ["worker hands", "speaker module", "device shell", "tray"],
  "shot": "close-up | medium | wide | establishing | detail | pov",
  "motion": "static | handheld | pan | tilt | push-in | follow",
  "tags": ["assembly", "speaker", "factory", "hands", "tray"],
  "quality": 1-5,                   // 5 = clean, sharp, well framed
  "usable": true,                   // false for shaky, blurred, blocked
  "sequence": "speaker-fit",        // optional: name the multi-clip sequence this belongs to
  "note": ""                        // anything the director should know (people's faces, logos, text on screen)
}
\`\`\`

Tags are what the SCRIPT would say, not what the vendor would say — if the
speaker says "the board", tag \`board\`, \`pcb\`, \`circuit\`.

| # | clip | shot at | dur | sheets |
| - | ---- | ------- | --- | ------ |
${clips
  .map(
    (c, i) =>
      `| ${i + 1} | \`${c.file}\` | ${c.shotAt.replace("T", " ")} | ${c.duration.toFixed(0)}s | ${c.sheets.map((s) => s.file.replace("sheets/", "")).join(", ")} |${c.described ? " ✓" : ""}`,
  )
  .join("\n")}
`;
await writeFile(join(OUT, "DESCRIBE.md"), md);
console.log(`\n${clips.length} clips, ${(totalDur / 60).toFixed(1)} min of footage, ${totalSheets} sheets -> ${OUT}/index.json`);
console.log(`worklist: ${OUT}/DESCRIBE.md`);
