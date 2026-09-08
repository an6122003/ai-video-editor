#!/usr/bin/env node
// Inventories a folder of images/videos and builds contact sheets so the agent
// can SEE every asset at once and describe it. This is step 1 of the media
// library flow: index -> describe -> match -> place.
//
//   node media-index.mjs <folder>            # default: media/library
//
// Writes media-library.json (the inventory, descriptions empty) and
// media/sheets/sheet-N.jpg (16 assets per sheet, labelled by index).
// Videos are represented by a frame from 40% through, which is usually past
// any intro card and onto the actual content.
import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname, relative } from "node:path";

const run = promisify(execFile);
const ROOT = process.argv[2] ?? "media/library";
const SHEET_DIR = "media/sheets";
const IMG = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"]);
const VID = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv"]);
const PER_SHEET = 16;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function probe(file) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,codec_name",
      "-show_entries", "format=duration",
      "-of", "json", file,
    ]);
    const j = JSON.parse(stdout);
    const s = j.streams?.[0] ?? {};
    return {
      w: s.width ?? null,
      h: s.height ?? null,
      codec: s.codec_name ?? null,
      duration: j.format?.duration ? +(+j.format.duration).toFixed(2) : null,
    };
  } catch {
    return { w: null, h: null, codec: null, duration: null };
  }
}

if (!existsSync(ROOT)) {
  console.error(`No such folder: ${ROOT}\nCreate it and drop your images/videos in, then re-run.`);
  process.exit(1);
}

const files = (await walk(ROOT)).filter((f) => {
  const e = extname(f).toLowerCase();
  return IMG.has(e) || VID.has(e);
});

if (!files.length) {
  console.error(`No images or videos found under ${ROOT}`);
  process.exit(1);
}

await mkdir(SHEET_DIR, { recursive: true });

const entries = [];
let i = 0;
for (const f of files) {
  const e = extname(f).toLowerCase();
  const kind = VID.has(e) ? "video" : "image";
  const meta = e === ".svg" ? { w: null, h: null, codec: "svg", duration: null } : await probe(f);
  const { size } = await stat(f);
  entries.push({
    id: i,
    file: relative(ROOT, f),
    path: f,
    kind,
    ...meta,
    sizeKB: Math.round(size / 1024),
    // Filled in by the agent after viewing the contact sheet:
    describes: "",
    keywords: [],
  });
  i++;
}

// Build contact sheets. Each tile is letterboxed to 360x360 and stamped with
// its index so the agent can refer to assets unambiguously.
const sheets = Math.ceil(entries.length / PER_SHEET);
for (let s = 0; s < sheets; s++) {
  const batch = entries.slice(s * PER_SHEET, (s + 1) * PER_SHEET).filter((b) => b.codec !== "svg");
  if (!batch.length) continue;
  const args = [];
  const filters = [];
  batch.forEach((b, n) => {
    if (b.kind === "video" && b.duration) {
      args.push("-ss", String(+(b.duration * 0.4).toFixed(2)), "-i", b.path);
    } else {
      args.push("-i", b.path);
    }
    // No drawtext in this ffmpeg build, so tiles carry no stamped number.
    // Position is the index: strict row-major, 4 per row. A thin border keeps
    // adjacent tiles from reading as one image.
    filters.push(
      `[${n}:v]scale=352:352:force_original_aspect_ratio=decrease,` +
        `pad=360:360:(ow-iw)/2:(oh-ih)/2:color=0x1a2433[t${n}]`,
    );
  });
  const chain =
    filters.join(";") +
    ";" +
    batch.map((_, n) => `[t${n}]`).join("") +
    `xstack=inputs=${batch.length}:layout=${layout(batch.length)}:fill=0x1a2433[out]`;
  const outFile = join(SHEET_DIR, `sheet-${s}.jpg`);
  try {
    await run("ffmpeg", [
      "-v", "error", ...args,
      "-filter_complex", chain,
      "-map", "[out]", "-frames:v", "1", "-q:v", "3", outFile, "-y",
    ]);
    console.log(`sheet ${s} -> ${outFile}`);
    batch.forEach((b, n) => console.log(`   tile ${n} (row ${Math.floor(n / 4)}, col ${n % 4})  id=${b.id}  ${b.file}`));
  } catch (err) {
    console.error(`sheet ${s} failed: ${String(err).slice(0, 200)}`);
  }
}

function layout(n) {
  const cols = Math.min(4, n);
  return Array.from({ length: n }, (_, k) => {
    const c = k % cols, r = Math.floor(k / cols);
    return `${c === 0 ? "0" : Array.from({ length: c }, (_, q) => `w${q}`).join("+")}_${
      r === 0 ? "0" : Array.from({ length: r }, (_, q) => `h${q * cols}`).join("+")
    }`;
  }).join("|");
}

await writeFile("media-library.json", JSON.stringify({ root: ROOT, assets: entries }, null, 2));
console.log(`\n${entries.length} assets indexed -> media-library.json`);
console.log(`View media/sheets/sheet-*.jpg, then fill in "describes" + "keywords" for each id.`);
