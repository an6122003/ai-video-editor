#!/usr/bin/env node
// Renders the described B-roll library as a browsable gallery: a grid of cards,
// one per SEGMENT, each showing the frame next to what the describe pass said
// about it. This is how you find a shot — by looking at 124 of them at once and
// searching what is IN them, not by reading JSON.
//
//   node bin/broll-review.mjs                 # from a project directory
//   node bin/broll-review.mjs --force         # re-extract every thumbnail
//   node bin/broll-review.mjs --clip lap-loa  # just one clip
//
// A segment, not a clip, is the unit: a 39-second take usually holds four
// different shots, and "the one where he turns the shell over" is a segment.
// The card carries the id, the in/out, the length, the frame shape and the
// action line, so a shot can be picked without opening anything.
//
// Clicking a card opens the editor for that segment. Correct anything, press
// "Download corrections", drop the file into broll/described/, and re-run
// bin/broll-index.mjs to fold it back in. The page never writes to disk — the
// describe pass stays append-only and nothing is silently overwritten.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FORCE = args.includes("--force");
const ONLY = flag("--clip", null);
const ROOT = flag("--broll", "broll");

const index = JSON.parse(await readFile(join(ROOT, "index.json"), "utf8"));
const clips = index.clips.filter((c) => !ONLY || c.id === ONLY);
await mkdir(join(ROOT, "thumbs"), { recursive: true });

// One frame per segment, taken a third of the way in — past the transition,
// before the shot changes character.
let made = 0, cached = 0;
for (const c of clips) {
  for (const [i, seg] of (c.segments ?? []).entries()) {
    const name = `${c.id}-${String(i).padStart(2, "0")}.jpg`;
    const dst = join(ROOT, "thumbs", name);
    seg._thumb = `thumbs/${name}`;
    if (existsSync(dst) && !FORCE) { cached++; continue; }
    const t = Math.min(c.duration - 0.2, seg.start + (seg.end - seg.start) / 3);
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-hwaccel", "cuda", "-ss", String(t.toFixed(2)), "-i", c.path,
        "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", dst]);
      made++;
    } catch {
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t.toFixed(2)), "-i", c.path,
        "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", dst]).catch(() => {});
      made++;
    }
  }
  process.stdout.write(`\r  ${c.id.padEnd(34)} ${(c.segments ?? []).length} segments   `);
}
console.log(`\n${made} thumbnails made, ${cached} cached`);

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// The frame shape, named the way a plan names it, so a vertical cut can be
// filtered for at a glance rather than worked out from 3840x2160.
const ratio = (w, h) => {
  if (!w || !h) return "";
  const r = w / h;
  if (r < 0.85) return "9:16";
  if (r > 1.5) return "16:9";
  return "1:1";
};

const allTags = [...new Set(clips.flatMap((c) => (c.segments ?? []).flatMap((s) => s.tags ?? [])))].sort();
const allSeq = [...new Set(clips.flatMap((c) => (c.segments ?? []).map((s) => s.sequence)).filter(Boolean))].sort();
const allShot = [...new Set(clips.flatMap((c) => (c.segments ?? []).map((s) => s.shot)).filter(Boolean))].sort();
const totalSegs = clips.reduce((n, c) => n + (c.segments ?? []).length, 0);
const usable = clips.reduce((n, c) => n + (c.segments ?? []).filter((s) => s.usable !== false).length, 0);
const secs = clips.reduce((n, c) => n + (c.segments ?? []).reduce((m, s) => m + (s.end - s.start), 0), 0);

// One flat list of cards. Grouping by clip is what the old page did, and it
// buried the thing you are actually looking for: the shot. The clip id stays on
// every card, so nothing is lost by flattening.
const cards = clips.flatMap((c) => (c.segments ?? []).map((s, i) => ({ c, s, i })));

const page = `<!doctype html><html><head><meta charset="utf-8"><title>B-roll library</title><style>
:root{--coral:#ef493d;--ink:#161c24;--slate:#454f5b;--mist:#637381;--chalk:#dfe3e8;--ghost:#f4f6f8;
 --parchment:#fdf5dd;--leaf:#3f7a23;--leafbg:#e7f6df;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);font:14px/1.5 "Noto Sans",system-ui,sans-serif}
header{position:sticky;top:0;z-index:30;background:var(--ink);color:#fff;padding:13px 22px;
 display:flex;gap:14px;align-items:center;flex-wrap:wrap;box-shadow:0 3px 0 rgba(22,28,36,.2)}
h1{font:800 19px/1 "Onest",sans-serif;margin:0;letter-spacing:-.02em;white-space:nowrap}
.stat{font:400 11px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--chalk);white-space:nowrap}
.sp{flex:1}
input[type=search]{padding:9px 13px;border:0;min-width:300px;flex:1;max-width:460px;font:14px "Noto Sans",sans-serif}
select{padding:9px 11px;border:0;font:13px "Noto Sans",sans-serif;background:var(--chalk);color:var(--ink)}
button{font:600 13px "Noto Sans",sans-serif;padding:9px 14px;border:0;cursor:pointer;background:var(--chalk);color:var(--ink);white-space:nowrap}
button.pri{background:var(--coral);color:#fff}
button.on{background:var(--coral);color:#fff}
button:disabled{opacity:.4;cursor:default}

/* The gallery. auto-fill rather than a fixed column count, so the same page
   works on a laptop and on the 5K the edit actually happens on. */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:16px;padding:18px 22px 120px}
.card{background:var(--card);border:2px solid var(--chalk);box-shadow:3px 3px 0 rgba(22,28,36,.10);
 display:flex;flex-direction:column;cursor:pointer;position:relative}
.card:hover{border-color:var(--slate)}
.card.sel{border-color:var(--coral);box-shadow:3px 3px 0 rgba(239,73,61,.3)}
.card.dirty::after{content:"edited";position:absolute;left:0;top:0;background:var(--coral);color:#fff;
 font:600 10px/1 "Noto Sans";padding:4px 7px;letter-spacing:.04em}
.card.unusable{opacity:.5}
.card.unusable .thumb{filter:grayscale(1)}
.thumb{position:relative;aspect-ratio:16/9;background:var(--ghost);overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pick{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;
 border:2px solid #fff;background:rgba(22,28,36,.35);box-shadow:0 0 0 1px rgba(22,28,36,.3)}
.card.sel .pick{background:var(--coral);border-color:#fff}
.card.sel .pick::after{content:"";position:absolute;left:6px;top:2px;width:5px;height:10px;
 border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.dur{position:absolute;left:8px;bottom:8px;background:rgba(22,28,36,.82);color:#fff;
 font:600 11px/1 "Noto Sans";padding:4px 6px}
.ar{position:absolute;right:8px;bottom:8px;background:var(--coral);color:#fff;
 font:600 10px/1 "Noto Sans";padding:4px 6px;letter-spacing:.03em}
.meta{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px;flex:1}
.cid{font:600 12px/1.2 "Noto Sans";color:var(--ink);word-break:break-all}
.sub{font:400 11px/1 "Tiny5",monospace;letter-spacing:.05em;color:var(--mist)}
.desc{font:400 13px/1.45 "Noto Sans";color:var(--slate);display:-webkit-box;-webkit-line-clamp:3;
 -webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:auto;padding-top:4px}
.chip{background:var(--leafbg);color:var(--leaf);padding:2px 6px;font-size:10.5px;line-height:1.5}
.q{color:var(--mist);font-size:10.5px}

/* The editor. A drawer rather than fields inline on every card: the grid is for
   finding a shot, and 124 sets of eight inputs is not a gallery. */
.scrim{position:fixed;inset:0;background:rgba(22,28,36,.45);z-index:40;display:none}
.scrim.open{display:block}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,94vw);background:var(--card);z-index:50;
 transform:translateX(100%);transition:transform .16s ease-out;overflow-y:auto;box-shadow:-4px 0 0 rgba(22,28,36,.15)}
.drawer.open{transform:none}
.dhead{position:sticky;top:0;background:var(--ink);color:#fff;padding:13px 18px;display:flex;gap:10px;align-items:center}
.dhead b{font:800 15px/1 "Onest",sans-serif}
.dbody{padding:16px 18px 40px;display:grid;gap:11px}
.dbody img{width:100%;display:block;background:var(--ghost)}
label{font:400 10.5px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--mist);text-transform:uppercase;display:block;margin-bottom:3px}
.f input,.f textarea,.f select{width:100%;padding:7px 9px;border:2px solid var(--chalk);font:14px "Noto Sans",sans-serif;background:#fff}
.f input:focus,.f textarea:focus{outline:0;border-color:var(--coral)}
.f textarea{resize:vertical;min-height:62px}
.g4{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px}
.hide{display:none !important}
.empty{padding:60px 22px;text-align:center;color:var(--mist)}
footer{position:fixed;left:0;right:0;bottom:0;z-index:35;background:var(--ink);color:#fff;
 padding:11px 22px;display:flex;gap:12px;align-items:center;box-shadow:0 -3px 0 rgba(22,28,36,.2)}
footer .stat{color:var(--chalk)}
</style></head><body>
<header>
  <h1>B-roll library</h1>
  <span class="stat">${clips.length} clips · ${totalSegs} shots · ${(secs / 60).toFixed(0)} min</span>
  <input type="search" id="q" placeholder="search what is in the shot — tag, action, subject, clip id…">
  <select id="fSeq"><option value="">All sequences</option>${allSeq.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
  <select id="fShot"><option value="">All shots</option>${allShot.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
  <button id="onlyU">Unusable only</button>
</header>

<div class="grid" id="grid">
${cards.map(({ c, s, i }) => `<div class="card ${s.usable === false ? "unusable" : ""}" data-clip="${esc(c.id)}" data-i="${i}"
  data-seq="${esc(s.sequence ?? "")}" data-shot="${esc(s.shot ?? "")}" data-usable="${s.usable === false ? "0" : "1"}"
  data-search="${esc([c.id, c.file, s.action, (s.tags || []).join(" "), (s.subject || []).join(" "), s.shot, s.motion, s.sequence, s.note].filter(Boolean).join(" ").toLowerCase())}">
  <div class="thumb">
    <img loading="lazy" src="${esc(s._thumb)}" alt="">
    <div class="pick"></div>
    <div class="dur">${mmss(s.start)}–${mmss(s.end)}</div>
    <div class="ar">${esc(ratio(c.width, c.height))}</div>
  </div>
  <div class="meta">
    <div class="cid">${esc(c.id)}<span class="q"> · ${i + 1}/${(c.segments ?? []).length}</span></div>
    <div class="sub">${(s.end - s.start).toFixed(0)}s${s.shot ? " · " + esc(s.shot) : ""}${s.quality ? " · q" + s.quality : ""}</div>
    <div class="desc">${esc(s.action)}</div>
    <div class="chips">${(s.tags || []).slice(0, 5).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
  </div>
</div>`).join("\n")}
</div>
<div class="empty hide" id="empty">Nothing matches that.</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer f" id="drawer">
  <div class="dhead"><b id="dTitle">—</b><span class="sp"></span><button id="dClose">Close</button></div>
  <div class="dbody" id="dBody"></div>
</aside>

<footer>
  <span class="stat" id="count">${totalSegs} shots</span>
  <span class="stat" id="selCount"></span>
  <span class="sp"></span>
  <button id="copyIds" disabled>Copy selected</button>
  <button id="clearSel" disabled>Clear selection</button>
  <button id="dl" class="pri" disabled>Download corrections</button>
</footer>

<script>
const base = ${JSON.stringify(Object.fromEntries(clips.map((c) => [c.id, (c.segments ?? []).map(({ _thumb, ...s }) => s)])))};
const thumbs = ${JSON.stringify(Object.fromEntries(clips.map((c) => [c.id, (c.segments ?? []).map((s) => s._thumb)])))};
const edits = {};
const sel = new Set();
const cards = [...document.querySelectorAll('.card')];
const key = (el) => el.dataset.clip + '#' + el.dataset.i;

/* ---- filtering ---- */
const q = document.getElementById('q'), fSeq = document.getElementById('fSeq'), fShot = document.getElementById('fShot');
let onlyU = false;
function refilter(){
  const t = q.value.trim().toLowerCase(), sq = fSeq.value, sh = fShot.value;
  let n = 0;
  for (const el of cards){
    const ok = (!t || el.dataset.search.includes(t))
      && (!sq || el.dataset.seq === sq)
      && (!sh || el.dataset.shot === sh)
      && (!onlyU || el.dataset.usable === '0');
    el.classList.toggle('hide', !ok);
    if (ok) n++;
  }
  document.getElementById('count').textContent = n + (n === 1 ? ' shot' : ' shots') + (n === cards.length ? '' : ' of ' + cards.length);
  document.getElementById('empty').classList.toggle('hide', n > 0);
}
q.addEventListener('input', refilter);
fSeq.addEventListener('change', refilter);
fShot.addEventListener('change', refilter);
document.getElementById('onlyU').onclick = function(){ onlyU = !onlyU; this.classList.toggle('on', onlyU); refilter(); };

/* ---- selection: the circle picks, the card body opens the editor ---- */
function syncSel(){
  const n = sel.size;
  document.getElementById('selCount').textContent = n ? n + ' selected' : '';
  document.getElementById('copyIds').disabled = !n;
  document.getElementById('clearSel').disabled = !n;
}
for (const el of cards){
  el.querySelector('.pick').addEventListener('click', (e) => {
    e.stopPropagation();
    const k = key(el);
    if (sel.has(k)) { sel.delete(k); el.classList.remove('sel'); } else { sel.add(k); el.classList.add('sel'); }
    syncSel();
  });
  el.addEventListener('click', () => open(el));
}
document.getElementById('clearSel').onclick = () => { sel.clear(); cards.forEach(c => c.classList.remove('sel')); syncSel(); };
document.getElementById('copyIds').onclick = () => {
  // The shape a plan references a shot by, ready to paste into an edit-plan.
  const out = [...sel].map(k => { const [id, i] = k.split('#'); const s = (edits[id] || base[id])[+i];
    return { clip: id, start: s.start, end: s.end, why: s.action }; });
  navigator.clipboard.writeText(JSON.stringify(out, null, 2));
  const b = document.getElementById('copyIds'); const t = b.textContent;
  b.textContent = 'Copied ' + out.length; setTimeout(() => b.textContent = t, 1200);
};

/* ---- the editor drawer ---- */
const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
let cur = null;
function field(k, label, val, type){
  const v = val === null || val === undefined ? '' : val;
  if (type === 'area') return '<div><label>' + label + '</label><textarea data-k="' + k + '">' + String(v).replace(/</g,'&lt;') + '</textarea></div>';
  return '<div><label>' + label + '</label><input data-k="' + k + '" ' + (type === 'num' ? 'type="number" step="0.1"' : '') + ' value="' + String(v).replace(/"/g,'&quot;') + '"></div>';
}
function open(el){
  cur = el;
  const id = el.dataset.clip, i = +el.dataset.i;
  const s = (edits[id] || base[id])[i];
  document.getElementById('dTitle').textContent = id + ' · shot ' + (i + 1);
  document.getElementById('dBody').innerHTML =
    '<img src="' + thumbs[id][i] + '" alt="">' +
    field('action', 'action — what is happening', s.action, 'area') +
    field('tags', 'tags — the words the SCRIPT would use, comma separated', (s.tags || []).join(', ')) +
    field('subject', 'subject, comma separated', (s.subject || []).join(', ')) +
    '<div class="g3">' + field('shot', 'shot', s.shot) + field('motion', 'motion', s.motion) + field('sequence', 'sequence', s.sequence) + '</div>' +
    '<div class="g3">' + field('start', 'start', s.start, 'num') + field('end', 'end', s.end, 'num') +
      '<div><label>quality 1-5</label><input data-k="quality" type="number" min="1" max="5" step="1" value="' + (s.quality ?? '') + '"></div></div>' +
    '<div><label>usable</label><select data-k="usable"><option value="true"' + (s.usable !== false ? ' selected' : '') + '>usable</option>' +
      '<option value="false"' + (s.usable === false ? ' selected' : '') + '>unusable</option></select></div>' +
    field('note', 'note', s.note);
  document.getElementById('dBody').querySelectorAll('[data-k]').forEach(inp => {
    inp.addEventListener('input', () => apply(inp));
    inp.addEventListener('change', () => apply(inp));
  });
  drawer.classList.add('open'); scrim.classList.add('open');
}
function close(){ drawer.classList.remove('open'); scrim.classList.remove('open'); cur = null; }
document.getElementById('dClose').onclick = close;
scrim.onclick = close;
addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

function apply(inp){
  const id = cur.dataset.clip, i = +cur.dataset.i, k = inp.dataset.k;
  edits[id] = edits[id] || JSON.parse(JSON.stringify(base[id]));
  let v = inp.value;
  if (k === 'tags' || k === 'subject') v = v.split(',').map(x => x.trim()).filter(Boolean);
  else if (k === 'start' || k === 'end' || k === 'quality') v = v === '' ? null : Number(v);
  else if (k === 'usable') v = v === 'true';
  edits[id][i][k] = v;
  cur.classList.add('dirty');
  document.getElementById('dl').disabled = false;
  // Keep the card in the grid honest about what the drawer just changed.
  if (k === 'action') cur.querySelector('.desc').textContent = v;
  if (k === 'tags') cur.querySelector('.chips').innerHTML = v.slice(0, 5).map(t =>
    '<span class="chip">' + t.replace(/</g, '&lt;') + '</span>').join('');
  if (k === 'usable') { cur.classList.toggle('unusable', v === false); cur.dataset.usable = v === false ? '0' : '1'; }
  if (k === 'shot') cur.dataset.shot = v;
  if (k === 'sequence') cur.dataset.seq = v;
}

document.getElementById('dl').onclick = function(){
  const blob = new Blob([JSON.stringify(edits, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'corrections.json'; a.click();
};
refilter(); syncSel();
</script></body></html>`;

await writeFile(join(ROOT, "review.html"), page);
console.log(`${clips.length} clips · ${totalSegs} shots · ${allTags.length} distinct tags · ${allSeq.length} sequences`);
console.log(`\n${join(ROOT, "review.html")}`);
