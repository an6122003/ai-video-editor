#!/usr/bin/env node
// Renders the whole layout library to a browsable HTML page, so a presentation
// can be chosen by looking at it rather than by reading a schema.
//
//   node bin/layouts.mjs                     # from a project directory
//   node bin/layouts.mjs --open              # ...and open it
//   node bin/layouts.mjs --only list,bignum  # just those types
//   node bin/layouts.mjs --bg <image|none>   # what sits behind the panels
//
// Output: layouts/index.html — every type:layout at real 1920x1080 scale, laid
// out in a grid, filterable by type, with a day/night switch, a backdrop toggle
// (panels are transparent, and a layout that reads on white can vanish over
// footage) and the JSON for each one ready to copy into an edit plan.
//
// The CSS and the renderer list are read straight out of bin/build-edit.mjs at
// run time, so this page cannot drift from what the builder actually produces.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = flag("--out", "layouts");
const ONLY = flag("--only", null)?.split(",").map((s) => s.trim());
const W = 1920, H = 1080;

const SAMPLE = {
  "lower-third": { wordmark: true, eyebrow: "LITTLE THING OF NOWA · EP. 02", title: "Why the pet doesn't speak human", sub: "One design decision, by Daniel", maxWidth: 940 },
  bignum: { eyebrow: "THE NEXT BATCH", value: 200, unit: "units", of: "2,000", label: "near production-ready", sub: "shipping to reviewers and testers", pct: 64 },
  list: { eyebrow: "WHAT THEY ALREADY GET TOO EARLY", title: "Three things, all at once",
    items: [{ text: "The internet", note: "before they can read it" }, { text: "Everything" }, { text: "All the knowledge there is" }] },
  checklist: { eyebrow: "EVT CHECKS", title: "Does every part work?", items: ["Speaker", "Scroll wheel", "Screen colour", "Buttons"] },
  process: { eyebrow: "HARDWARE PHASES", steps: ["EVT", "DVT", "PVT"], labels: ["Engineering validation", "Design validation", "Production validation"], active: 1 },
  callout: { eyebrow: "WHY IT MATTERS", text: "Too many toys are bolting AI on, lazily", sub: "Same companion, same voice, in every box." },
  timeline: { eyebrow: "ROADMAP", active: 1, items: [{ when: "Mid September", what: "DVT — 200 units ship" }, { when: "End of September", what: "PVT — production" }, { when: "October", what: "Official launch" }] },
  statement: { eyebrow: "THE WORLD THEY GROW UP IN", text: "By ten or eleven / they will have a dozen AI agents / all talking to them", sub: "and not one of them asks the child to imagine anything" },
  quote: { text: "They should imagine and interpret what the pet is trying to say", attrib: "the reason for the whole thing" },
  compare: { win: 1,
    left: { head: "LANGUAGE", big: "Words", items: ["One meaning, handed to you"], pct: 34 },
    right: { head: "VOICE", big: "Sound", items: ["A range of emotion"], pct: 92 } },
  plate: { eyebrow: "SOURCE VISUAL", title: "Main headline here / supporting statement",
    caption: "Add a short caption or context about these images here.",
    maxHeight: 520, src: "sample1.png", source: "Sample placeholder · CC0 · provider",
    images: [1, 2, 3, 4].map((i) => ({ src: `sample${i}.png`, sourceShort: "yoursource.com", credit: "Sample · CC0" })) },
  endcard: { title: "Little Thing of Nowa", sub: "Episode two · by Daniel", cta: "See you in the next one" },
  annotate: { shape: "circle", box: [700, 240, 520, 420], label: "the thing itself", beat: "sample" },
  cells: { count: 8, filled: 5, label: "one in every room", cols: 4 },
};
const SHAPES = ["circle", "underline", "arrow", "bracket"];

// ── read the library and the stylesheet out of the builder ────────────────
const builder = await readFile(join(REPO, "bin/build-edit.mjs"), "utf8");

const block = builder.match(/^const renderers = \{[ \t]*\r?$([\s\S]*?)^\};[ \t]*\r?$/m);
if (!block) { console.error("could not find the renderers block in bin/build-edit.mjs"); process.exit(1); }
const order = [];
let type = null;
for (const line of block[1].split("\n")) {
  const t = line.match(/^  ("?[\w-]+"?): \{\s*$/);
  if (t) { type = t[1].replace(/"/g, ""); continue; }
  const l = line.match(/^    ([\w-]+): \(c\) =>/);
  if (l && type) order.push({ type, layout: l[1] });
}

// Evaluate the builder's renderers with the helpers they close over, so the
// page uses the real markup rather than a copy that can rot.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Card markup goes into data-* attributes, and it is full of double quotes —
// escaping only &<> lets the first class="..." close the attribute and mangle
// the DOM, which silently breaks every layout on the page.
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const eyebrow = (t) => (t ? `<div class="eyebrow el">${esc(t)}</div>` : "");
const wordmark = (theme, w = 180) => `<img class="wordmark el" src="brand/${theme === "night" ? "nowa-wordmark-pastel.svg" : "nowa-wordmark.svg"}" style="width:${w}px" alt="Nowa" />`;
const TICK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M4 12l5 5L20 6"/></svg>`;
const li = (it) => (typeof it === "string" ? { text: it } : it);
const lines = (t) => String(t).split(" / ");
const words = (t) => String(t).split(/\s+/).map((w) => `<span class="qw">${esc(w)}</span>`).join(" ");
const num = (c) => {
  const numeric = typeof c.value === "number" || /^[\d,.]+$/.test(String(c.value));
  return `<span class="num" data-to="${esc(c.value)}">${esc(c.value)}</span>`;
};
const blocks = (t) => t ? `<div class="pblocks">${lines(t).map((l, i) => `<div class="pblk el" data-i="${i}"><span>${esc(l)}</span></div>`).join("")}</div>` : "";
const figIMG = (im) => `<span class="pmount"><img src="${esc(im.src)}" alt="" /></span>`;
const srcChip = (im) => im.sourceShort ? `<span class="srcchip">Source: ${esc(im.sourceShort)}</span>` : "";
const sceneHTML = (c, n) => {
  const im = c.images.slice(0, n);
  const fig = (x, cls = "") => `<div class="pfig ${cls} el">${figIMG(x)}${srcChip(x)}</div>`;
  const art =
    n === 1 ? fig(im[0], "pfig--main")
    : n === 2 ? `<div class="pstack2">${fig(im[0], "pfig--main")}${im[1] ? fig(im[1], "pfig--sec") : ""}</div>`
    : n === 3 ? `<div class="pstack3">${fig(im[0], "pfig--main")}<div class="pcol">${im.slice(1).map((x) => fig(x, "pfig--small")).join("")}</div></div>`
    : `<div class="pstack4">${fig(im[0], "pfig--main")}<div class="prow">${im.slice(1).map((x) => fig(x, "pfig--small")).join("")}</div></div>`;
  return `
    <div class="pscene pscene--${n}">
      <div class="pcopy">${eyebrow(c.eyebrow)}${blocks(c.title)}${c.caption ? `<div class="pcap el">${esc(c.caption)}</div>` : ""}</div>
      <div class="part">${art}</div>
    </div>`;
};
const renderers = new Function("esc", "eyebrow", "wordmark", "TICK", "li", "lines", "words", "num", "W", "H", "blocks", "figIMG", "srcChip", "sceneHTML",
  `return (${block[0].replace(/^const renderers = /, "").replace(/;\s*$/, "")});`)(esc, eyebrow, wordmark, TICK, li, lines, words, num, W, H, blocks, figIMG, srcChip, sceneHTML);

// the <style> the builder emits, minus the @font-face block (added separately)
// CRLF-tolerant: this file is edited by several tools with different endings.
const styleM = builder.match(/[ \t]*<style>\r?\n([\s\S]*?)\r?\n[ \t]*<\/style>/);
if (!styleM) { console.error("could not find the <style> block in bin/build-edit.mjs"); process.exit(1); }
let css = styleM[1]
  // The portrait-only rules are one interpolation precisely so this can drop
  // them: the gallery renders 16:9 cards, and a portrait band, an ink caption
  // chip and half-scale display type would all be wrong here.
  .replace(/\$\{PORTRAIT_CSS\}/g, "").replace(/\$\{BAND_CSS\}/g, "")
  .replace(/\$\{fontfaces\.trimEnd\(\)\}/g, "")
  .replace(/\$\{W\}/g, String(W)).replace(/\$\{H\}/g, String(H))
  .replace(/\$\{OVERLAY \? "transparent" : "var\(--ink\)"\}/g, "transparent");
// resolve the remaining ${step(n)} / ${STEP_CARD} / ${STEP_CHIP} calls
const step = (n) => {
  const h = n / 2, P = (x, y) => `${x} ${y}`;
  return `polygon(${[P(0, `${n}px`), P(`${h}px`, `${n}px`), P(`${h}px`, `${h}px`), P(`${n}px`, `${h}px`), P(`${n}px`, 0),
    P(`calc(100% - ${n}px)`, 0), P(`calc(100% - ${n}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${n}px`), P("100%", `${n}px`),
    P("100%", `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, "100%"),
    P(`${n}px`, "100%"), P(`${n}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${n}px)`), P(0, `calc(100% - ${n}px)`)].join(",")})`;
};
css = css.replace(/\$\{STEP_CARD\}/g, step(24)).replace(/\$\{STEP_CHIP\}/g, step(16))
         .replace(/\$\{step\((\d+)\)\}/g, (_, n) => step(Number(n)));
// The builder's stylesheet owns a whole PAGE — `html, body { overflow: hidden }`
// and a full-viewport #stage. Dropped into a scrolling gallery those rules
// freeze it, so take the card styles and leave the page furniture behind.
for (const sel of ["html, body", "#stage", ".aroll, .aroll video", ".aroll video",
                   ".broll", ".broll video", ".broll--inset", ".broll--inset video",
                   ".caption-scrim", ".caption", ".caption b.k", ".caption b.kw"]) {
  const re = new RegExp(`^\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}\\s*$`, "m");
  css = css.replace(re, "");
}
if (/\$\{/.test(css)) console.log("note: unresolved interpolation left in the CSS — some layouts may look wrong");

// ── assets ────────────────────────────────────────────────────────────────
await mkdir(join(OUT, "brand"), { recursive: true });
await mkdir(join(OUT, "fonts"), { recursive: true });
for (const f of ["nowa-wordmark.svg", "nowa-wordmark-pastel.svg"]) await copyFile(join(REPO, "system/nowa/brand", f), join(OUT, "brand", f));
const fontfaces = await readFile("_fontfaces.css", "utf8");
for (const f of (await import("node:fs/promises")).then ? [] : []) void f;
const { readdir } = await import("node:fs/promises");
for (const f of await readdir("fonts")) if (!existsSync(join(OUT, "fonts", f))) await copyFile(join("fonts", f), join(OUT, "fonts", f));

// a placeholder for the plate layouts, and a still from the A-roll as backdrop
for (const [i, col] of [["1", "0xdfe3e8"], ["2", "0xc9d2da"], ["3", "0xe4e9ed"], ["4", "0xd2dae0"]]) {
  const f = join(OUT, `sample${i}.png`);
  if (existsSync(f)) continue;
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${col}:s=1600x900`,
    "-vf", `drawbox=x=0:y=0:w=1600:h=900:color=0x9aa5ad:t=14,drawtext=text='IMAGE ${i}':fontcolor=0x6b7681:fontsize=90:x=(w-tw)/2:y=(h-th)/2`,
    "-frames:v", "1", f]).catch(async () => {
      await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${col}:s=1600x900`,
        "-vf", "drawbox=x=0:y=0:w=1600:h=900:color=0x9aa5ad:t=14", "-frames:v", "1", f]);
    });
}
const sample = join(OUT, "sample1.png");
const BG = flag("--bg", null);
const backdrop = join(OUT, "backdrop.jpg");
if (BG !== "none" && !existsSync(backdrop)) {
  const src = BG ?? "out/01_aroll_clean.mp4";
  if (existsSync(src)) await run("ffmpeg", ["-v", "error", "-y", "-ss", "30", "-i", src, "-frames:v", "1", "-vf", `scale=${W}:-2`, backdrop]);
}
const hasBackdrop = existsSync(backdrop);

// ── build the page ────────────────────────────────────────────────────────
const entries = [];
for (const { type: ty, layout: lay } of order) {
  if (ONLY && !ONLY.includes(ty)) continue;
  if (ty === "annotate") for (const shape of SHAPES) entries.push({ ty, lay, shape });
  else entries.push({ ty, lay });
}

const FULL = new Set(["endcard", "statement", "list", "compare", "quote", "plate"]);
const PANEL_LAYOUTS = { plate: new Set(["inset"]) };
const isFull = (ty, lay) => FULL.has(ty) && !PANEL_LAYOUTS[ty]?.has(lay);
const OVERLAY = new Set(["annotate", "cells"]);
const WIDE = new Set(["timeline:track", "process:chips"]);

function cardHTML(e, theme) {
  const c = { ...structuredClone(SAMPLE[e.ty] ?? {}), type: e.ty, layout: e.lay, theme, side: "left" };
  if (e.shape) c.shape = e.shape;
  const cls = ["pxcard", `pxcard--${theme}`, `pxcard--${e.ty}`, `lay--${e.ty}-${e.lay}`];
  let style;
  if (isFull(e.ty, e.lay) || OVERLAY.has(e.ty)) style = `left:0;top:0;width:${W}px;height:${H}px;`;
  else if (e.ty === "lower-third") style = `left:72px;bottom:180px;max-width:${c.maxWidth ?? 900}px;`;
  else if (e.ty === "plate") style = `left:72px;top:50%;transform:translateY(-50%);width:800px;`;
  else {
    // same rule the builder uses: a panel wider than half the frame centres
    // and drops into the band under the face instead of sitting in a corner
    const w = WIDE.has(`${e.ty}:${e.lay}`) ? 1180 : 680;
    const wide = w > W * 0.55;
    style = wide
      ? `left:${Math.round((W - w) / 2)}px;bottom:180px;width:${w}px;`
      : `left:72px;top:50%;transform:translateY(-50%);width:${w}px;`;
  }
  return `<div class="${cls.join(" ")}" style="${style}"><div class="face"></div><div class="body">${renderers[e.ty][e.lay](c)}</div></div>`;
}

const json = (e) => JSON.stringify({ type: e.ty, ...(e.lay === (order.find((o) => o.type === e.ty)?.layout) ? {} : { layout: e.lay }), ...(e.shape ? { shape: e.shape } : {}) });

const byType = {};
for (const e of entries) (byType[e.ty] ??= []).push(e);

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nowa video — layout library</title>
<style>
${fontfaces}
:root{--coral:#ef493d;--ink:#161c24;--slate:#454f5b;--mist:#637381;--cloud:#c4cdd5;--chalk:#dfe3e8;--parchment:#fdf5dd;--white:#fff;}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);font-family:"Noto Sans",system-ui,sans-serif;
  background-image:linear-gradient(rgba(22,28,36,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(22,28,36,.05) 1px,transparent 1px);background-size:28px 28px;}
header{position:sticky;top:0;z-index:10;background:var(--ink);color:#fff;padding:22px 32px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;
  box-shadow:0 4px 0 rgba(22,28,36,.18)}
h1{font:800 26px/1 "Onest",sans-serif;letter-spacing:-.02em;margin:0}
.count{font:400 14px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--cloud)}
.spacer{flex:1}
.ctl{display:flex;gap:8px;align-items:center}
button{font:600 13px/1 "Noto Sans",sans-serif;padding:9px 14px;border:0;cursor:pointer;color:var(--ink);background:var(--chalk);
  clip-path:polygon(0 6px,3px 6px,3px 3px,6px 3px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 3px,calc(100% - 3px) 3px,calc(100% - 3px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 3px) calc(100% - 6px),calc(100% - 3px) calc(100% - 3px),calc(100% - 6px) calc(100% - 3px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 3px),3px calc(100% - 3px),3px calc(100% - 6px),0 calc(100% - 6px))}
button.on{background:var(--coral);color:#fff}
main{padding:32px;display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:34px}
figure{margin:0}
.stage{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--ink);
  outline:3px solid var(--ink);outline-offset:0;box-shadow:8px 8px 0 rgba(22,28,36,.16)}
.stage .inner{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
.stage .bd{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
body.nobg .stage .bd{display:none}
body.nobg .stage{background:#20262f}
figcaption{margin-top:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}
.nm{font:800 19px/1.2 "Onest",sans-serif;letter-spacing:-.01em}
.ty{font:400 12px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--mist);text-transform:uppercase}
code{font:500 12.5px/1.5 ui-monospace,Menlo,monospace;background:#fff;border:2px solid var(--chalk);padding:5px 9px;cursor:pointer;white-space:nowrap}
code:hover{border-color:var(--coral)}
.note{padding:18px 32px 8px;color:var(--slate);font-size:14px;max-width:82ch;line-height:1.55}
.note code{cursor:auto;white-space:normal}
${css}
/* the gallery's own frame wins over anything imported above */
html,body{overflow:visible !important;height:auto !important;width:auto !important}
body{background:var(--parchment) !important;font-family:"Noto Sans",system-ui,sans-serif !important}
.stage .inner{overflow:hidden}
</style></head>
<body>
<header>
  <h1>Layout library</h1>
  <span class="count">${entries.length} presentations · ${Object.keys(byType).length} types</span>
  <span class="spacer"></span>
  <span class="ctl"><button id="t-day" class="on">Day</button><button id="t-night">Night</button></span>
  ${hasBackdrop ? `<span class="ctl"><button id="bg-on" class="on">On footage</button><button id="bg-off">Plain</button></span>` : ""}
</header>
<p class="note">Every presentation the builder can produce, at true 1920&times;1080 and scaled to fit.
<strong>type</strong> is what the data is; <strong>layout</strong> is how it looks. Click a snippet to copy it,
then paste it into a beat's <code style="cursor:auto">card</code> in <code style="cursor:auto">edit-plan.json</code>.
Panels are transparent, so check them against footage — a layout that reads on a plain ground can disappear over a face.</p>
<main id="grid">
${entries.map((e) => `  <figure data-type="${e.ty}">
    <div class="stage">${hasBackdrop ? `<img class="bd" src="backdrop.jpg" alt="">` : ""}<div class="inner" data-day="${escAttr(cardHTML(e, "day"))}" data-night="${escAttr(cardHTML(e, "night"))}">${cardHTML(e, "day")}</div></div>
    <figcaption><span class="nm">${e.ty} · ${e.lay}${e.shape ? ` · ${e.shape}` : ""}</span><span class="ty">${isFull(e.ty, e.lay) ? "full frame" : OVERLAY.has(e.ty) ? "over footage" : "panel"}</span><code>${esc(json(e))}</code></figcaption>
  </figure>`).join("\n")}
</main>
<script>
  // scale each 1920x1080 stage into whatever width the grid gives it
  function fit(){ document.querySelectorAll('.stage').forEach(function(s){
    var i=s.querySelector('.inner'); i.style.transform='scale('+(s.clientWidth/${W})+')'; }); }
  addEventListener('resize', fit); fit();
  function setTheme(t){
    document.querySelectorAll('.inner').forEach(function(i){ i.innerHTML=i.dataset[t]; });
    document.getElementById('t-day').classList.toggle('on', t==='day');
    document.getElementById('t-night').classList.toggle('on', t==='night');
    fit();
  }
  document.getElementById('t-day').onclick=function(){ setTheme('day'); };
  document.getElementById('t-night').onclick=function(){ setTheme('night'); };
  var on=document.getElementById('bg-on'), off=document.getElementById('bg-off');
  if(on){ on.onclick=function(){ document.body.classList.remove('nobg'); on.classList.add('on'); off.classList.remove('on'); };
          off.onclick=function(){ document.body.classList.add('nobg'); off.classList.add('on'); on.classList.remove('on'); }; }
  document.querySelectorAll('code').forEach(function(c){ if(c.style.cursor==='auto') return;
    c.onclick=function(){ navigator.clipboard.writeText(c.textContent); var t=c.textContent; c.textContent='copied'; setTimeout(function(){ c.textContent=t; },700); }; });
</script>
</body></html>`;

await writeFile(join(OUT, "index.html"), page);
const counts = Object.entries(byType).map(([t, v]) => `${t}×${v.length}`).join("  ");
console.log(`${entries.length} presentations across ${Object.keys(byType).length} types`);
console.log(counts);
console.log(`\n${resolve(join(OUT, "index.html"))}`);
if (args.includes("--open")) await run("cmd", ["/c", "start", "", resolve(join(OUT, "index.html"))]).catch(() => {});
