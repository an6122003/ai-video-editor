#!/usr/bin/env node
// Builds the directory you upload to your own server, so collaborators pull
// footage instead of being handed 12.4 GB.
//
//   node bin/broll-publish.mjs --base https://media.example.com/broll/nowa-factory
//        [--out dist/broll] [--name nowa-factory] [--proxy-width 640] [--crf 30]
//        [--no-originals] [--force]
//
// Then: rsync -av --delete dist/broll/ you@server:/var/www/broll/nowa-factory/
//
// What it writes, and why each tier exists:
//
//   library.json   the catalogue. Every clip, every described segment, plus the
//                  size and sha256 of each file. 180 KB, and it is the ONLY
//                  thing a client needs to search the whole library.
//   thumbs/        one frame per segment, ~2.8 MB, so the gallery renders
//                  before a single video has been fetched.
//   proxy/         640p H.264. Measured on real footage: 2.5 MB/min against
//                  419 MB/min for the source — 166x smaller. A 27-minute
//                  library becomes ~70 MB, which is watchable over anything.
//   original/      the camera files. Pulled per-edit, never in bulk.
//
// The catalogue is SERVED, not committed, because the library grows on its own
// clock: you add footage, describe it, re-publish, and every client sees the
// new shots by running broll-pull. Nobody re-clones. Each project commits a
// broll/library.lock pinning the version it was cut against, so an edit stays
// reproducible after the library moves on.
//
// Nothing here needs an SDK or a credential. It is a directory of static files;
// any HTTPS server with Range support (nginx, Caddy, Apache — all of them by
// default) is enough, and Range is what lets a client fetch six seconds out of
// a 271 MB clip.
import { readFile, writeFile, mkdir, copyFile, stat, readdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join, basename, extname } from "node:path";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const ROOT = flag("--broll", "broll");
const OUT = flag("--out", "dist/broll");
const BASE = flag("--base", null);
const NAME = flag("--name", null);
const PW = Number(flag("--proxy-width", 640));
const CRF = Number(flag("--crf", 30));
const WITH_ORIG = !has("--no-originals");
const FORCE = has("--force");

if (!BASE) {
  console.error("--base <https://your.server/path/to/library> is required — it goes into library.json\n" +
    "so a client only has to be told one URL. Example:\n" +
    "  node bin/broll-publish.mjs --base https://media.example.com/broll/nowa-factory");
  process.exit(1);
}
const LIB = NAME ?? BASE.replace(/\/+$/, "").split("/").pop();

const index = JSON.parse(await readFile(join(ROOT, "index.json"), "utf8"));
const clips = index.clips.filter((c) => (c.segments ?? []).length);
if (!clips.length) { console.error(`no described clips in ${join(ROOT, "index.json")}`); process.exit(1); }

await mkdir(join(OUT, "proxy"), { recursive: true });
await mkdir(join(OUT, "thumbs"), { recursive: true });
if (WITH_ORIG) await mkdir(join(OUT, "original"), { recursive: true });

const sha256 = (f) => new Promise((res, rej) => {
  const h = createHash("sha256");
  createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
});
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

// A published clip is addressed by its id, not by the camera's filename: two
// cards can both hold a DJI_0004.MP4 and the id is already what a plan
// references.
const out = [];
let proxyBytes = 0, origBytes = 0, encoded = 0, skipped = 0, missing = 0;

for (const [n, c] of clips.entries()) {
  const tag = `[${String(n + 1).padStart(2)}/${clips.length}] ${c.id}`;
  if (!existsSync(c.path)) { console.log(`${tag}  SOURCE MISSING — skipped (${c.path})`); missing++; continue; }

  const proxyName = `${c.id}.mp4`;
  const proxyPath = join(OUT, "proxy", proxyName);
  if (existsSync(proxyPath) && !FORCE) { skipped++; process.stdout.write(`\r${tag}  proxy cached          `); }
  else {
    process.stdout.write(`\r${tag}  encoding proxy...     `);
    // -an: the proxies are for LOOKING at. The edit takes its audio from the
    // A-roll, and B-roll is laid in silent, so shipping proxy audio would be
    // paying for something nothing reads.
    const vf = `scale=${PW}:-2`;
    await run("ffmpeg", ["-y", "-v", "error", "-i", c.path, "-vf", vf, "-c:v", "libx264",
      "-preset", "veryfast", "-crf", String(CRF), "-g", "30", "-an", "-movflags", "+faststart", proxyPath]);
    encoded++;
  }
  const ps = await stat(proxyPath);
  proxyBytes += ps.size;

  const entry = {
    id: c.id, file: c.file, shotAt: c.shotAt,
    width: c.width, height: c.height, fps: c.fps, duration: c.duration,
    segments: c.segments,
    proxy: { name: proxyName, bytes: ps.size, sha256: await sha256(proxyPath), width: PW },
  };

  if (WITH_ORIG) {
    const origName = `${c.id}${extname(c.path) || ".mp4"}`;
    const origPath = join(OUT, "original", origName);
    if (!existsSync(origPath) || FORCE) {
      process.stdout.write(`\r${tag}  copying original...   `);
      await copyFile(c.path, origPath);
    }
    const os_ = await stat(origPath);
    origBytes += os_.size;
    entry.original = { name: origName, bytes: os_.size, sha256: await sha256(origPath) };
  }
  out.push(entry);
}
process.stdout.write("\r".padEnd(70) + "\r");

// The thumbnails the gallery renders from. They are also committed to the repo,
// but a client who pulls a NEWER library than their checkout needs the frames
// for clips their checkout has never heard of.
let thumbs = 0;
if (existsSync(join(ROOT, "thumbs"))) {
  for (const f of await readdir(join(ROOT, "thumbs"))) {
    if (!/\.jpg$/i.test(f)) continue;
    await copyFile(join(ROOT, "thumbs", f), join(OUT, "thumbs", f));
    thumbs++;
  }
}

// Version = the content, not a counter someone has to remember to bump. A
// client compares this to its lock and knows whether anything moved.
const fingerprint = createHash("sha256")
  .update(JSON.stringify(out.map((c) => [c.id, c.proxy.sha256, c.original?.sha256 ?? "", c.segments.length])))
  .digest("hex").slice(0, 12);

const library = {
  library: LIB,
  version: fingerprint,
  generatedAt: new Date().toISOString(),
  base: BASE.replace(/\/+$/, ""),
  proxyWidth: PW,
  totals: {
    clips: out.length,
    segments: out.reduce((n, c) => n + c.segments.length, 0),
    seconds: Math.round(out.reduce((n, c) => n + c.duration, 0)),
    proxyBytes, originalBytes: origBytes, thumbs,
  },
  clips: out,           // note: no absolute `path` — that is local to whoever shot it
};
await writeFile(join(OUT, "library.json"), JSON.stringify(library, null, 2));

const catalogueBytes = (await stat(join(OUT, "library.json"))).size;
console.log(`${LIB}  version ${fingerprint}`);
console.log(`  ${out.length} clips · ${library.totals.segments} segments · ${(library.totals.seconds / 60).toFixed(1)} min`);
if (missing) console.log(`  ${missing} clips skipped — source file not on this machine`);
console.log(`  ${encoded} proxies encoded, ${skipped} cached, ${thumbs} thumbnails\n`);
console.log(`  library.json  ${mb(catalogueBytes).padStart(9)}   search the whole library, no video`);
console.log(`  thumbs/       ${mb((await dirBytes(join(OUT, "thumbs")))).padStart(9)}   see every shot`);
console.log(`  proxy/        ${mb(proxyBytes).padStart(9)}   watch and cut the whole library`);
if (WITH_ORIG) console.log(`  original/     ${mb(origBytes).padStart(9)}   final render only, pulled per edit`);
// The comparison is against the CAMERA files, which is the number that makes
// the case — and it is knowable from the local index even when --no-originals
// means none were copied into the upload.
const sourceBytes = await (async () => {
  const { statSync } = await import("node:fs");
  let n = 0;
  for (const c of clips) { try { n += statSync(c.path).size; } catch { /* not on this machine */ } }
  return n;
})();
const toCut = catalogueBytes + (await dirBytes(join(OUT, "thumbs"))) + proxyBytes;
if (sourceBytes > toCut)
  console.log(`\n  a client cuts the whole library on ${mb(toCut)} instead of ${mb(sourceBytes)} ` +
    `— ${(sourceBytes / toCut).toFixed(0)}x less\n`);
else console.log("");
console.log(`Upload:\n  rsync -av --delete ${OUT}/ you@server:/var/www/${LIB}/\n`);
console.log(`Clients then run:\n  node bin/broll-pull.mjs --remote ${library.base}\n`);

async function dirBytes(d) {
  if (!existsSync(d)) return 0;
  let n = 0;
  for (const f of await readdir(d)) n += (await stat(join(d, f))).size;
  return n;
}
