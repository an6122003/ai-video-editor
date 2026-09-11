#!/usr/bin/env node
// Thumbnail concepts in the Nowa system, rendered through the same HyperFrames
// snapshot path as the video so type and corners match the edit exactly.
//
//   node bin/thumbnails.mjs [--config thumbnails.json] [--out thumbs]
//
// thumbnails.json (in the project dir) names the frames and the copy:
// {
//   "frames": { "face": ["aroll", "truly in person", 0.4], "trays": ["dji-20260805102055-0029-d", 28], "macro": ["dji-20260805103145-0035-d", 12] },
//   "variants": [
//     { "id": "a", "layout": "face-card",  "frame": "face",  "eyebrow": "AUGUST UPDATE", "title": "The first 50 are built", "sub": "EVT done in Shenzhen" },
//     { "id": "b", "layout": "bignum",     "frame": "trays", "value": "50", "title": "units. Tested. Passed." },
//     { "id": "c", "layout": "split",      "frame": "face",  "frame2": "macro", "title": "EVT done.", "sub": "October launch" }
//   ]
// }
// A frame spec is [clipId | "aroll", time | phrase, offset?]. Phrases resolve
// against work/transcript.clean.json on the A-roll. Output: thumbs/out/*.png
// (1280×720) plus a contact sheet — pick one, or feed a frame back in.
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = flag("--out", "thumbs");
const cfg = JSON.parse(await readFile(flag("--config", "thumbnails.json"), "utf8"));
const plan = existsSync("edit-plan.json") ? JSON.parse(await readFile("edit-plan.json", "utf8")) : {};
const index = JSON.parse(await readFile("broll/index.json", "utf8"));
const clipById = new Map(index.clips.map((c) => [c.id, c]));
const words = JSON.parse(await readFile("work/transcript.clean.json", "utf8"));
const W = 1280, H = 720;

await mkdir(join(OUT, "frames"), { recursive: true });
await mkdir(join(OUT, "vendor"), { recursive: true });
await mkdir(join(OUT, "brand"), { recursive: true });
await copyFile(join(REPO, "node_modules/gsap/dist/gsap.min.js"), join(OUT, "vendor/gsap.min.js"));
for (const f of ["nowa-wordmark.svg", "nowa-wordmark-pastel.svg"]) await copyFile(join(REPO, "system/nowa/brand", f), join(OUT, "brand", f));
// fonts: reuse the project's fetched set
await mkdir(join(OUT, "fonts"), { recursive: true });
for (const f of await readdir("fonts")) if (!existsSync(join(OUT, "fonts", f))) await copyFile(join("fonts", f), join(OUT, "fonts", f));
const fontfaces = await readFile("_fontfaces.css", "utf8");

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
function phraseTime(phrase) {
  const want = phrase.split(/\s+/).map(norm);
  outer: for (let i = 0; i <= words.length - want.length; i++) {
    for (let k = 0; k < want.length; k++) if (norm(words[i + k].text) !== want[k]) continue outer;
    return words[i].start;
  }
  throw new Error(`phrase not found: "${phrase}"`);
}
async function grab(name, [src, at, offset = 0]) {
  const t = (typeof at === "number" ? at : phraseTime(at)) + offset;
  const file = src === "aroll" ? (plan.aroll ?? "out/01_aroll_clean.mp4") : clipById.get(src)?.path;
  if (!file) throw new Error(`unknown frame source ${src}`);
  const out = join(OUT, "frames", `${name}.jpg`);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${W * 2}:-2`, "-q:v", "2", out]);
  return `frames/${name}.jpg`;
}
const frames = {};
for (const [name, spec] of Object.entries(cfg.frames)) frames[name] = await grab(name, spec);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const step = (n) => { const h = n / 2, P = (x, y) => `${x} ${y}`; return `polygon(${[P(0, `${n}px`), P(`${h}px`, `${n}px`), P(`${h}px`, `${h}px`), P(`${n}px`, `${h}px`), P(`${n}px`, 0), P(`calc(100% - ${n}px)`, 0), P(`calc(100% - ${n}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${n}px`), P("100%", `${n}px`), P("100%", `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, "100%"), P(`${n}px`, "100%"), P(`${n}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${n}px)`), P(0, `calc(100% - ${n}px)`)].join(",")})`; };

// Where the card sits over full-bleed footage. The subject is rarely centred,
// so the card has to be told which corner is empty — a card over the product
// is a thumbnail with no product in it.
const CORNER = {
  "bottom-left": "left:48px;bottom:48px", "bottom-right": "right:48px;bottom:48px",
  "top-left": "left:48px;top:48px", "top-right": "right:48px;top:48px",
};
const corner = (v, dflt) => CORNER[v.pos ?? dflt] ?? CORNER[dflt];

const layouts = {
  // full-bleed face, ink card in the empty corner
  "face-card": (v) => `
    <img class="bg" src="${frames[v.frame]}" style="object-position:${v.focus ?? "60% 40%"}" />
    <div class="scrim"></div>
    <div class="pxcard night" style="${corner(v, "bottom-left")};max-width:${v.maxWidth ?? 720}px">
      <div class="face"></div>
      <div class="body">
        <img class="wordmark" src="brand/nowa-wordmark-pastel.svg" style="width:150px" alt="Nowa" />
        ${v.eyebrow ? `<div class="eyebrow">${esc(v.eyebrow)}</div>` : ""}
        <div class="title">${esc(v.title)}</div>
        ${v.sub ? `<div class="sub">${esc(v.sub)}</div>` : ""}
      </div>
    </div>`,
  // full-bleed footage, giant coral number on a white card — the footage is the
  // hero here, so the card is deliberately smaller than in face-card
  bignum: (v) => `
    <img class="bg" src="${frames[v.frame]}" style="object-position:${v.focus ?? "50% 50%"}" />
    <div class="pxcard day" style="${corner(v, "top-left")};max-width:${v.maxWidth ?? 540}px">
      <div class="face"></div>
      <div class="body">
        <img class="wordmark" src="brand/nowa-wordmark.svg" style="width:130px" alt="Nowa" />
        <div class="num">${esc(v.value)}</div>
        <div class="title">${esc(v.title)}</div>
      </div>
    </div>`,
  // speaker left, product right, headline over the seam
  split: (v) => `
    <img class="half l" src="${frames[v.frame]}" style="object-position:${v.focus ?? "60% 40%"}" />
    <img class="half r" src="${frames[v.frame2]}" style="object-position:${v.focus2 ?? "50% 50%"}" />
    <div class="seam"></div>
    <div class="pxcard day" style="left:50%;top:50%;transform:translate(-50%,-50%);max-width:820px;text-align:center">
      <div class="face"></div>
      <div class="body" style="align-items:center">
        <img class="wordmark" src="brand/nowa-wordmark.svg" style="width:170px" alt="Nowa" />
        <div class="title big">${esc(v.title)}</div>
        ${v.sub ? `<div class="sub">${esc(v.sub)}</div>` : ""}
      </div>
    </div>`,
};

const variants = cfg.variants.map((v, i) => `
      <div class="thumb clip" id="thumb-${v.id}" data-start="${i}" data-duration="1" data-track-index="1">${layouts[v.layout](v)}
      </div>`).join("\n");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>thumbnails</title>
<style>
${fontfaces}
:root{--coral:#ef493d;--blush:#fececa;--ink:#161c24;--slate:#454f5b;--cloud:#c4cdd5;--chalk:#dfe3e8;--white:#fff;--grid:rgba(255,255,255,.06)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--ink);font-family:"Noto Sans",sans-serif}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
.thumb{position:absolute;inset:0;overflow:hidden}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.half{position:absolute;top:0;width:50%;height:100%;object-fit:cover}.half.l{left:0}.half.r{left:50%}
.seam{position:absolute;left:calc(50% - 4px);top:0;width:8px;height:100%;background:var(--white)}
.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(22,28,36,0) 40%,rgba(22,28,36,.55) 100%)}
.pxcard{position:absolute;--bg:var(--white);--border:var(--chalk);--ink2:var(--ink);--sub:var(--slate);filter:drop-shadow(8px 8px 0 var(--blush))}
.pxcard.night{--bg:var(--ink);--border:rgba(255,255,255,.16);--ink2:var(--white);--sub:var(--cloud);filter:drop-shadow(8px 8px 0 rgba(0,0,0,.35))}
.pxcard .face{position:absolute;inset:0;clip-path:${step(20)};background:linear-gradient(var(--bg),var(--bg)) 2px 2px/calc(100% - 4px) calc(100% - 4px) no-repeat,var(--border)}
.pxcard.night .face{background:linear-gradient(var(--grid) 2px,transparent 2px) 2px 2px/48px 48px,linear-gradient(90deg,var(--grid) 2px,transparent 2px) 2px 2px/48px 48px,linear-gradient(var(--bg),var(--bg)) 2px 2px/calc(100% - 4px) calc(100% - 4px) no-repeat,var(--border)}
.body{position:relative;z-index:1;padding:36px 40px;display:flex;flex-direction:column;gap:14px;color:var(--ink2)}
.wordmark{display:block}
.eyebrow{font:400 22px/1 "Tiny5",monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--sub)}
.title{font:800 58px/1.05 "Onest",sans-serif;letter-spacing:-.03em}.title.big{font-size:72px}
.sub{font:600 26px/1.3 "Noto Sans",sans-serif;color:var(--sub)}
.num{font:800 190px/.95 "Onest",sans-serif;letter-spacing:-.05em;color:var(--coral)}
</style></head>
<body>
<div id="stage" data-composition-id="thumbs" data-start="0" data-duration="${cfg.variants.length}" data-fps="30" data-width="${W}" data-height="${H}">
${variants}
<script src="vendor/gsap.min.js"></script>
<script>var tl=window.gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines['thumbs']=tl;</script>
</div></body></html>`;
await writeFile(join(OUT, "index.html"), html);

const ats = cfg.variants.map((_, i) => (i + 0.5).toFixed(1)).join(",");
const { stdout } = await run("npx", ["hyperframes", "snapshot", OUT, "--at", ats, "--no-end", "-o", join(OUT, "out")], { shell: true, maxBuffer: 8 * 1024 * 1024 });
console.log(stdout.split("\n").filter((l) => /saved|frame-/.test(l)).join("\n"));
console.log(`${cfg.variants.length} thumbnail concepts -> ${OUT}/out/`);
