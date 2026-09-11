#!/usr/bin/env node
// Renders the described B-roll library as a browsable, editable page: one
// thumbnail per SEGMENT beside the fields that describe it, so a wrong tag or
// a mistimed boundary can be corrected by looking rather than by reading JSON.
//
//   node bin/broll-review.mjs                 # from a project directory
//   node bin/broll-review.mjs --force         # re-extract every thumbnail
//   node bin/broll-review.mjs --clip lap-loa  # just one clip
//
// Output: broll/review.html. Edit in the browser, press "Download corrections",
// drop the file into broll/described/, and re-run bin/broll-index.mjs to fold
// it back in. The page never writes to disk itself — the describe pass stays
// append-only, and nothing is silently overwritten.
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
const allTags = [...new Set(clips.flatMap((c) => (c.segments ?? []).flatMap((s) => s.tags ?? [])))].sort();
const totalSegs = clips.reduce((n, c) => n + (c.segments ?? []).length, 0);
const usable = clips.reduce((n, c) => n + (c.segments ?? []).filter((s) => s.usable !== false).length, 0);
const secs = clips.reduce((n, c) => n + (c.segments ?? []).reduce((m, s) => m + (s.end - s.start), 0), 0);

const page = `<!doctype html><html><head><meta charset="utf-8"><title>B-roll library</title><style>
:root{--coral:#ef493d;--ink:#161c24;--slate:#454f5b;--mist:#637381;--chalk:#dfe3e8;--ghost:#f4f6f8;--parchment:#fdf5dd;--leaf:#3f7a23;--leafbg:#e7f6df}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);font:14px/1.5 "Noto Sans",system-ui,sans-serif;
 background-image:linear-gradient(rgba(22,28,36,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(22,28,36,.05) 1px,transparent 1px);background-size:28px 28px}
header{position:sticky;top:0;z-index:20;background:var(--ink);color:#fff;padding:16px 26px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 0 rgba(22,28,36,.18)}
h1{font:800 22px/1 "Onest",sans-serif;margin:0;letter-spacing:-.02em}
.stat{font:400 12px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--chalk)}
.sp{flex:1}
input[type=search]{padding:8px 12px;border:0;width:260px;font:14px "Noto Sans",sans-serif}
button{font:600 13px "Noto Sans",sans-serif;padding:9px 15px;border:0;cursor:pointer;background:var(--chalk);color:var(--ink)}
button.pri{background:var(--coral);color:#fff}
button:disabled{opacity:.45;cursor:default}
.note{margin:16px 26px;padding:13px 17px;background:#fff8e8;border:2px solid #f3dca0;max-width:96ch}
h2{margin:26px 26px 4px;font:800 17px/1.3 "Onest",sans-serif}
h2 small{font:400 12px/1 "Tiny5",monospace;color:var(--mist);letter-spacing:.06em;margin-left:8px}
.rows{margin:0 26px}
.r{display:grid;grid-template-columns:300px 1fr;gap:16px;background:#fff;border:2px solid var(--chalk);
 box-shadow:4px 4px 0 rgba(22,28,36,.10);margin-bottom:12px;padding:12px}
.r.unusable{opacity:.55;background:var(--ghost)}
.r.dirty{border-color:var(--coral);box-shadow:4px 4px 0 rgba(239,73,61,.25)}
.r img{width:100%;display:block;background:var(--ghost)}
.tm{font:600 12px/1 "Noto Sans";color:var(--mist);margin-top:6px;display:flex;gap:8px;align-items:center}
.f{display:grid;gap:7px}
.f label{font:400 11px/1 "Tiny5",monospace;letter-spacing:.06em;color:var(--mist);text-transform:uppercase}
.f input,.f textarea,.f select{width:100%;padding:6px 8px;border:2px solid var(--chalk);font:14px "Noto Sans",sans-serif;background:#fff}
.f input:focus,.f textarea:focus{outline:0;border-color:var(--coral)}
.f textarea{resize:vertical;min-height:44px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px}
.g2{display:grid;grid-template-columns:90px 90px 1fr;gap:8px}
.chip{display:inline-block;background:var(--leafbg);color:var(--leaf);padding:2px 7px;font-size:11.5px;margin:2px 3px 0 0}
.hide{display:none !important}
</style></head><body>
<header>
  <h1>B-roll library</h1>
  <span class="stat">${clips.length} clips · ${totalSegs} segments · ${usable} usable · ${(secs / 60).toFixed(0)} min described</span>
  <span class="sp"></span>
  <input type="search" id="q" placeholder="filter by tag, action, clip…">
  <button id="onlyU">Only unusable</button>
  <button id="dl" class="pri" disabled>Download corrections</button>
</header>
<div class="note"><strong>Edit anything here, then press Download corrections.</strong> You get a
<code>described/corrections.json</code> in the same shape the describe pass writes. Drop it into
<code>broll/described/</code> and re-run <code>node ../../bin/broll-index.mjs &lt;folder&gt; --out broll</code> to fold it in.
This page never writes to disk, so nothing you have already described can be silently overwritten.</div>
${clips.map((c) => `
<h2>${esc(c.file)} <small>${c.duration.toFixed(0)}s · ${c.width}×${c.height} · ${esc(c.shotAt.replace("T", " "))}</small></h2>
<div class="rows" data-clip="${esc(c.id)}">
${(c.segments ?? []).map((s, i) => `  <div class="r ${s.usable === false ? "unusable" : ""}" data-clip="${esc(c.id)}" data-i="${i}"
   data-search="${esc([c.id, c.file, s.action, (s.tags || []).join(" "), s.shot, s.sequence, s.note].filter(Boolean).join(" ").toLowerCase())}">
    <div>
      <img loading="lazy" src="${esc(s._thumb)}" alt="">
      <div class="tm"><span>${mmss(s.start)} – ${mmss(s.end)}</span><span>${(s.end - s.start).toFixed(0)}s</span>
        <span>${(s.tags || []).slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</span></div>
    </div>
    <div class="f">
      <div><label>action</label><textarea data-k="action">${esc(s.action)}</textarea></div>
      <div><label>tags — the words the SCRIPT would use, comma separated</label><input data-k="tags" value="${esc((s.tags || []).join(", "))}"></div>
      <div class="g3">
        <div><label>shot</label><input data-k="shot" value="${esc(s.shot)}"></div>
        <div><label>motion</label><input data-k="motion" value="${esc(s.motion)}"></div>
        <div><label>sequence</label><input data-k="sequence" value="${esc(s.sequence)}"></div>
        <div><label>subject</label><input data-k="subject" value="${esc((s.subject || []).join(", "))}"></div>
      </div>
      <div class="g2">
        <div><label>start</label><input data-k="start" type="number" step="0.1" value="${s.start}"></div>
        <div><label>end</label><input data-k="end" type="number" step="0.1" value="${s.end}"></div>
        <div><label>quality 1–5 · usable</label>
          <div style="display:flex;gap:8px"><input data-k="quality" type="number" min="1" max="5" step="1" value="${s.quality ?? ""}" style="width:80px">
          <select data-k="usable"><option value="true"${s.usable !== false ? " selected" : ""}>usable</option><option value="false"${s.usable === false ? " selected" : ""}>unusable</option></select></div></div>
      </div>
      <div><label>note</label><input data-k="note" value="${esc(s.note)}"></div>
    </div>
  </div>`).join("\n")}
</div>`).join("\n")}
<script>
const base = ${JSON.stringify(Object.fromEntries(clips.map((c) => [c.id, (c.segments ?? []).map(({ _thumb, ...s }) => s)])))};
const edits = {};
function mark(row){ row.classList.add('dirty'); document.getElementById('dl').disabled = false; }
document.querySelectorAll('.r').forEach(row=>{
  row.querySelectorAll('[data-k]').forEach(el=>{
    el.addEventListener('input', ()=>{ apply(row, el); mark(row); });
    el.addEventListener('change', ()=>{ apply(row, el); mark(row); });
  });
});
function apply(row, el){
  const id=row.dataset.clip, i=+row.dataset.i, k=el.dataset.k;
  edits[id] = edits[id] || JSON.parse(JSON.stringify(base[id]));
  let v = el.value;
  if (k==='tags'||k==='subject') v = v.split(',').map(s=>s.trim()).filter(Boolean);
  else if (k==='start'||k==='end'||k==='quality') v = v===''? null : Number(v);
  else if (k==='usable') v = v==='true';
  edits[id][i][k]=v;
  if (k==='usable') row.classList.toggle('unusable', v===false);
}
document.getElementById('dl').onclick=function(){
  // only the clips actually touched, in the shape the describe pass writes
  const out={}; Object.keys(edits).forEach(id=>{ out[id]=edits[id]; });
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='corrections.json'; a.click();
};
const q=document.getElementById('q');
q.addEventListener('input',()=>{ const t=q.value.trim().toLowerCase();
  document.querySelectorAll('.r').forEach(r=>r.classList.toggle('hide', t && !r.dataset.search.includes(t)));
  document.querySelectorAll('.rows').forEach(g=>{ const any=[...g.querySelectorAll('.r')].some(r=>!r.classList.contains('hide'));
    g.classList.toggle('hide',!any); g.previousElementSibling.classList.toggle('hide',!any); });
});
let onlyU=false;
document.getElementById('onlyU').onclick=function(){ onlyU=!onlyU; this.classList.toggle('pri',onlyU);
  document.querySelectorAll('.r').forEach(r=>r.classList.toggle('hide', onlyU && !r.classList.contains('unusable'))); };
</script></body></html>`;

await writeFile(join(ROOT, "review.html"), page);
console.log(`${clips.length} clips · ${totalSegs} segments · ${allTags.length} distinct tags`);
console.log(`\n${join(ROOT, "review.html")}`);
