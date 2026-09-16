#!/usr/bin/env node
// Pulls from a published B-roll library instead of shipping the footage.
//
//   node bin/broll-pull.mjs --remote https://media.example.com/broll/nowa-factory
//        # catalogue + thumbnails only. ~3 MB. You can now search and PLAN.
//
//   node bin/broll-pull.mjs --proxies
//        # + the 640p library. ~70 MB. You can now watch, cut and draft-render.
//
//   node bin/broll-pull.mjs --plan build-9x16/plan.resolved.json
//        # + the originals THAT plan uses. ep.01: 7 clips of 40, 2.1 GB of 12.4.
//
// The tiering exists because the demand is so lopsided: ep.01 puts 40 seconds
// of B-roll on screen and touches 7 of 40 clips. Handing someone 12.4 GB so
// they can use 40 seconds is the thing being fixed.
//
// There is deliberately no byte-range mode. Fetching "just the seconds a plan
// uses" out of an MP4 needs its moov atom parsed to turn a timestamp into a
// byte offset; slicing by proportional position instead yields fragments
// nothing will decode, and the only honest thing such a mode could do is fall
// back to the whole file — a flag that looks like it saves bandwidth while
// quietly downloading everything. If tier 3 ever hurts, the fix is for
// broll-publish to cut each described SEGMENT as its own file: measured on
// ep.01 that is 803 MB instead of 2.07 GB, it needs no MP4 parsing, and every
// file stays independently valid.
//
// After any pull, broll/index.json is rewritten with `path` pointing at
// whatever is actually on disk — proxy or original. Nothing downstream needs a
// flag: bin/build-edit.mjs builds from what it finds, so a proxy pull gives a
// soft draft and an original pull gives the real thing.
//
// broll/library.lock records the catalogue version the project was cut
// against. Commit it. When the library moves on, the lock is what tells you
// whether your edit still refers to the footage it was made from.
import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const ROOT = flag("--broll", "broll");
const PLAN = flag("--plan", null);
const PROXIES = has("--proxies");
const ALL = has("--all-originals");
const FORCE = has("--force");
const CONCURRENCY = Number(flag("--jobs", 4));

await mkdir(ROOT, { recursive: true });
const lockPath = join(ROOT, "library.lock");
const prevLock = existsSync(lockPath) ? JSON.parse(await readFile(lockPath, "utf8")) : null;
const REMOTE = (flag("--remote", null) ?? prevLock?.base ?? "").replace(/\/+$/, "");
if (!REMOTE) {
  console.error("--remote <https://your.server/path/to/library> is required the first time.\n" +
    "After that it is remembered in broll/library.lock.");
  process.exit(1);
}

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

// A published library sits behind the studio's shared password, so every
// request needs a credential. The gate accepts HTTP Basic with an empty
// username, which is the same thing `curl -u :password` sends.
//
// Passed as --password, or BROLL_PASSWORD in the environment. Prefer the
// environment: an argument is visible in `ps` to every other user on the
// machine and lands in your shell history.
const PASSWORD = flag("--password", null) ?? process.env.BROLL_PASSWORD ?? "";
const AUTH = PASSWORD ? `Basic ${Buffer.from(`:${PASSWORD}`).toString("base64")}` : "";

const get = async (url, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (AUTH) headers.Authorization = AUTH;
  const r = await fetch(url, { ...init, headers });
  if (r.status === 401) {
    throw new Error(
      AUTH
        ? `401 Unauthorized — the password was not accepted by ${new URL(url).host}.`
        : ["401 Unauthorized — this library needs the studio password.",
           "    Pass it as BROLL_PASSWORD=... or --password <password>.",
           "    Get it from whoever runs the studio; it is the same one the website asks for.",
          ].join("\n"));
  }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r;
};

// ---- the catalogue -------------------------------------------------------
process.stdout.write(`catalogue ${REMOTE}/library.json ... `);
const lib = await (await get(`${REMOTE}/library.json`)).json();
console.log(`${lib.library} version ${lib.version} — ${lib.totals.clips} clips, ` +
  `${lib.totals.segments} segments, ${(lib.totals.seconds / 60).toFixed(1)} min`);
if (prevLock && prevLock.version !== lib.version)
  console.log(`  the library moved: you were on ${prevLock.version}, this is ${lib.version}`);

// ---- work out what is actually wanted ------------------------------------
// A plan names the clips it uses and the exact seconds of each. That is the
// whole reason this can be cheap.
let want = new Map();                        // clip id -> [{in, out}] or true
if (PLAN) {
  if (!existsSync(PLAN)) { console.error(`no such plan: ${PLAN}`); process.exit(1); }
  const plan = JSON.parse(await readFile(PLAN, "utf8"));
  for (const b of plan.brolls ?? []) {
    const id = b.clip ?? b.id;
    if (!id) continue;
    const handle = b.handle ?? 1;            // the builder trims with handles
    const from = Math.max(0, (b.in ?? 0) - handle);
    const to = (b.in ?? 0) + (b.dur ?? 0) + handle;
    want.set(id, [...(want.get(id) ?? []), { from, to }]);
  }
  if (!want.size) console.log(`  ${PLAN} references no B-roll`);
} else if (ALL) {
  for (const c of lib.clips) want.set(c.id, true);
}

// ---- thumbnails ----------------------------------------------------------
await mkdir(join(ROOT, "thumbs"), { recursive: true });
let gotThumbs = 0, thumbBytes = 0;
const thumbNames = lib.clips.flatMap((c) => c.segments.map((_, i) => `${c.id}-${String(i).padStart(2, "0")}.jpg`));
await pool(thumbNames, CONCURRENCY, async (name) => {
  const dst = join(ROOT, "thumbs", name);
  if (existsSync(dst) && !FORCE) return;
  try {
    const r = await get(`${REMOTE}/thumbs/${name}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(dst, buf);
    gotThumbs++; thumbBytes += buf.length;
  } catch { /* a segment with no frame is not fatal — the card just has no image */ }
});
if (gotThumbs) console.log(`  thumbnails: ${gotThumbs} new (${mb(thumbBytes)})`);

// ---- media ---------------------------------------------------------------
await mkdir(join(ROOT, "proxy"), { recursive: true });
await mkdir(join(ROOT, "original"), { recursive: true });

const jobs = [];
for (const c of lib.clips) {
  if (PROXIES) jobs.push({ c, kind: "proxy", meta: c.proxy });
  const w = want.get(c.id);
  if (w && c.original) jobs.push({ c, kind: "original", meta: c.original });
}

let done = 0, bytes = 0, cached = 0;
await pool(jobs, CONCURRENCY, async (j) => {
  const dir = j.kind === "proxy" ? "proxy" : "original";
  const dst = join(ROOT, dir, j.meta.name);
  if (existsSync(dst) && !FORCE) {
    const s = await stat(dst);
    if (s.size === j.meta.bytes) { cached++; return; }
  }
  // .part then rename: an interrupted pull must not leave a short file that the
  // size check above would later mistake for a complete one.
  const r = await get(`${REMOTE}/${dir}/${j.meta.name}`);
  const tmp = `${dst}.part`;
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  await rename(tmp, dst);
  bytes += j.meta.bytes;
  done++;
  process.stdout.write(`\r  ${dir}: ${done}/${jobs.filter((x) => x.kind === j.kind).length} ` +
    `(${mb(bytes)})`.padEnd(24));
});
if (jobs.length) process.stdout.write("\n");

// ---- rewrite the local index ---------------------------------------------
// `path` points at the best copy on disk. Downstream reads a path, not a tier,
// so nothing else in the pipeline needs to know this happened.
const localIndex = {
  generatedAt: new Date().toISOString(),
  source: `${lib.base} (${lib.library} ${lib.version})`,
  remote: { base: lib.base, library: lib.library, version: lib.version, proxyWidth: lib.proxyWidth },
  totals: lib.totals,
  clips: lib.clips.map((c) => {
    const orig = c.original && existsSync(join(ROOT, "original", c.original.name)) ? join(ROOT, "original", c.original.name) : null;
    const prox = existsSync(join(ROOT, "proxy", c.proxy.name)) ? join(ROOT, "proxy", c.proxy.name) : null;
    return {
      id: c.id, file: c.file, shotAt: c.shotAt,
      width: c.width, height: c.height, fps: c.fps, duration: c.duration,
      path: orig ?? prox ?? "", tier: orig ? "original" : prox ? "proxy" : "none",
      segments: c.segments, described: true,
    };
  }),
};
await writeFile(join(ROOT, "index.json"), JSON.stringify(localIndex, null, 2));
await writeFile(lockPath, JSON.stringify({
  base: lib.base, library: lib.library, version: lib.version, pulledAt: localIndex.generatedAt,
  clips: Object.fromEntries(localIndex.clips.map((c) => [c.id, c.tier])),
}, null, 2));

// `tier` is what a build will USE, so a clip holding both reports as original.
// The counts below say what is ON DISK, which is a different question and the
// one someone looking at 2 GB of files is actually asking.
const have = localIndex.clips.reduce((a, c) => { a[c.tier] = (a[c.tier] ?? 0) + 1; return a; }, {});
const onDisk = lib.clips.reduce((a, c) => {
  if (c.original && existsSync(join(ROOT, "original", c.original.name))) a.original++;
  if (existsSync(join(ROOT, "proxy", c.proxy.name))) a.proxy++;
  return a;
}, { original: 0, proxy: 0 });
console.log(`\n${lib.library} ${lib.version} -> ${join(ROOT, "index.json")}`);
console.log(`  on disk: ${onDisk.original} originals · ${onDisk.proxy} proxies · ${have.none ?? 0} catalogue-only`);
if (onDisk.original && onDisk.proxy)
  console.log(`  builds from: ${have.original ?? 0} originals, ${have.proxy ?? 0} proxies`);
if (cached) console.log(`  ${cached} files already local`);
console.log(`  pulled ${mb(bytes + thumbBytes)} of a ${mb(lib.totals.originalBytes || lib.totals.proxyBytes)} library`);
if (!PROXIES && !want.size)
  console.log(`\nYou can search and plan now: node bin/broll-review.mjs && open ${ROOT}/review.html\n` +
    `To watch the shots too:  node bin/broll-pull.mjs --proxies`);
else if (have.original && have.proxy)
  console.log(`\nMixed tiers — a render will be sharp where you pulled originals and soft where you did not.`);

// Small bounded worker pool. Downloads are latency-bound, so a handful in
// flight is the difference between three minutes and twenty.
async function pool(items, n, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let x = it.next(); !x.done; x = it.next()) await fn(x.value);
  }));
}
