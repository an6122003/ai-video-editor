#!/usr/bin/env node
// An À Ha video builder — assembles a talking-head composition from a project
// config. Copied into a project by the /an-aha-video workflow; edit
// video.config.mjs, never this file.
//
//   node build-video.mjs             -> build/index.html
//   node build-video.mjs --overlay   -> build-overlay/index.html (alpha, no audio)
//
// Design system: references/DESIGN-SYSTEM.md (An À Ha video layer v1.1).
//   - Space Grotesk display, Be Vietnam Pro body. Both cover Vietnamese.
//   - Cards centre; headlines are fitted to one line, never wrapped.
//   - One dominant accent per card. Solid by default, glass when the footage
//     is still doing work.
//   - Motion: 600ms card in / 280ms element / 180ms out / 900ms chart.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

// Resolved from the WORKING directory, not from this file: the builder lives in
// bin/ and the project config sits in the project root, so a relative import
// would look in the wrong place.
const config = (
  await import(pathToFileURL(join(process.cwd(), "video.config.mjs")).href)
).default;

const { CARDS, SURFACE, LOGOS_FILE = "logos.json" } = config;

// Captions-only: an alpha pass carrying the caption layer and nothing else —
// no cards, no assets, no footage. For editors who want to time or restyle
// subtitles independently of the graphics.
const CAPTIONS_ONLY = process.argv.includes("--captions-only");
const OVERLAY = CAPTIONS_ONLY || process.argv.includes("--overlay");
const OUT = CAPTIONS_ONLY
  ? (config.outDir ?? "build") + "-captions"
  : OVERLAY
    ? (config.outDir ?? "build") + "-overlay"
    : (config.outDir ?? "build");

const FPS = config.fps ?? 30;
const W = config.width ?? 1080;
const H = config.height ?? 1920;
const DUR = config.duration;
const VIDEO_SRC = config.videoSrc ?? "input-video.mp4";
// Overlay builds may point at a trimmed clip covering only the PiP window.
const OVERLAY_SRC = config.overlayVideoSrc ?? null;

// PiP sits TOP-RIGHT by default. On TikTok the right action rail (profile /
// like / comment / share) runs roughly y 950-1650 and the caption + handle own
// the bottom ~300px, so a bottom-right pill is the one place guaranteed to be
// covered. See references/PLATFORM-FURNITURE.md.
const PIP = config.pip ?? { x: 674, y: 290, width: 350 };
const PIP_SCALE = +(PIP.width / W).toFixed(5);

// Named pill positions. All sit in the top band (y 250-900): below the platform
// chrome, above where TikTok's action rail starts. A static pill for a 30s
// stretch goes dead, so the section is authored as a MOVE LIST — the speaker
// relocates on the beat, and the move itself is the motion.
const PIP_POS = {
  topright: { x: 674, y: 290, w: 350 },
  topleft: { x: 56, y: 290, w: 350 },
  topcenter: { x: 365, y: 260, w: 350 },
  // Smaller — for the densest data beats, where the speaker is context not subject.
  cornerright: { x: 760, y: 270, w: 264 },
  cornerleft: { x: 56, y: 270, w: 264 },
  // Larger — for a narrative beat inside a data section.
  heroright: { x: 540, y: 250, w: 484 },
};
const pipAt = (name) => PIP_POS[name] ?? PIP_POS.topright;
const pipScale = (p) => +(p.w / W).toFixed(5);
const HAS_PIP = Boolean(config.pipSection);
const P = config.pipSection ?? {};
const PIP_LIFT = P.lift ?? 0;
const PIP_IN = P.in ?? 0;
const PIP_IN_DUR = P.inDur ?? 0.75;
const PIP_OUT = P.out ?? 0;
const PIP_OUT_DUR = P.outDur ?? 0.7;
const PIP_DROP = P.drop ?? 0;
const BACKDROP = { start: PIP_LIFT, end: PIP_DROP };

const q = (t) => (Math.round(t * FPS) / FPS).toFixed(4);

// ── GSAP compiler ─────────────────────────────────────────────────────────
// The web system tiers motion by interaction; video has no pointer, so the
// same durations re-map to narrative roles (see VIDEO-SYSTEM.md §Motion):
//   600ms card entrance · 280ms element · 180ms exit · 900ms chart
// --ease-out  cubic-bezier(.22,1,.36,1)   -> expo.out
// --ease-spring cubic-bezier(.34,1.56,.64,1) -> back.out(1.56)  (emphasis only)
function compile(card, surface) {
  const S = (sel) => `.card[data-card-id="${card.id}"] ${sel}`;
  const out = [];
  const host = `.card-host[data-card-id="${card.id}"]`;

  // Card entrance: translateY + opacity, 600ms. Never scale — the system
  // enters by rising, not by growing.
  out.push(`  tl.set('${host}', { visibility: 'visible' }, ${q(card.start)});`);
  out.push(
    `  tl.fromTo('${host}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }, ${q(card.start)});`,
  );

  for (const a of card.anims) {
    const T = q(card.start + a.t);
    const sel = S(a.sel);
    switch (a.kind) {
      case "fadeUp":
        out.push(
          `  tl.fromTo('${sel}', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.28, ease: 'expo.out' }, ${T});`,
        );
        break;
      case "slideLeft":
        out.push(
          `  tl.fromTo('${sel}', { opacity: 0, x: -34 }, { opacity: 1, x: 0, duration: 0.28, ease: 'expo.out' }, ${T});`,
        );
        break;
      case "pop": // emphasis — the sanctioned spring
        out.push(
          `  tl.fromTo('${sel}', { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.28, ease: 'back.out(1.56)' }, ${T});`,
        );
        break;
      case "chars":
        out.push(
          `  tl.from('${sel} .char', { opacity: 0, y: 28, duration: 0.28, ease: 'expo.out', stagger: 0.08 }, ${T});`,
        );
        break;
      case "maskLeft":
        out.push(
          `  tl.fromTo('${sel}', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.28, ease: 'expo.out' }, ${T});`,
        );
        break;
      case "growX": // chart tier — 900ms, deliberately slower than the eye
        out.push(
          `  tl.fromTo('${sel}', { width: 0 }, { width: ${a.w}, duration: 0.9, ease: 'expo.out' }, ${T});`,
        );
        break;
      case "countUp": // chart tier — never faster than the bar beside it
        out.push(
          `  (function () { var o = { v: ${a.from} }; tl.to(o, { v: ${a.to}, duration: 0.9, ease: 'power2.out', onUpdate: function () { var el = document.querySelector('${sel}'); if (el) el.textContent = window.__fmt(o.v, '${a.fmt}'); } }, ${T}); })();`,
        );
        break;
      default:
        throw new Error(`unknown anim kind: ${a.kind}`);
    }
  }

  // Dynamic band: the grid drifts and the glow crosses over the card's whole
  // life. One linear tween each — no repeat, no CSS animation, so a seek to any
  // frame lands on the right position.
  if (surface === "band-dark") {
    const life = +(card.end - card.start).toFixed(3);
    out.push(
      `  tl.fromTo('${S(".bg-grid")}', { x: 0, y: 0 }, { x: -128, y: -128, duration: ${life}, ease: 'none' }, ${q(card.start)});`,
    );
    out.push(
      `  tl.fromTo('${S(".bg-glow")}', { x: -260, y: 120, scale: 1 }, { x: 300, y: -80, scale: 1.35, duration: ${life}, ease: 'sine.inOut' }, ${q(card.start)});`,
    );
  }
  out.push(`  tl.to('${host}', { opacity: 0, duration: 0.18, ease: 'power2.in' }, ${q(card.end - 0.18)});`);
  out.push(`  tl.set('${host}', { visibility: 'hidden' }, ${q(card.end)});`);
  return out.join("\n");
}

// ── brand marks ───────────────────────────────────────────────────────────
// Placement is derived from the transcript, not guessed: logos.json seeds each
// `at` from the moment the brand is actually SAID (see transcript.json). The
// manifest is the control surface — edit it, rebuild, and Studio hot-reloads.
// A missing file renders as a labelled placeholder so the edit can be timed
// before the assets exist.
const LOGO_SLOTS = {
  // Small marks: below the 250px platform chrome, above the face, clear of the
  // PiP column.
  topleft: { left: 56, top: 300, align: "flex-start" },
  topcenter: { left: 0, right: 0, top: 300, align: "center" },
  topright: { right: 56, top: 300, align: "flex-end" },
  // Big evidence: a screenshot, chart or clip shown large enough to actually
  // read. Spans the lower half and centres inside it, so the asset's CENTRE
  // lands on the 3/4 line (y=1440) regardless of its height.
  insert: { left: 0, right: 0, top: 960, bottom: 0, align: "center", justify: "center" },
  // True frame centre. The only slot that lands ON the speaker's face, which is
  // why it is also the only one that blurs the footage behind it.
  center: { left: 0, right: 0, top: 0, bottom: 0, align: "center", justify: "center" },
  // Corner insert — for when the footage still matters more than the asset.
  pip: { right: 56, top: 300, align: "flex-end" },
  wall: { left: 0, right: 0, top: 0, bottom: 0, align: "center" },
};

const LOGOS = existsSync(LOGOS_FILE) ? JSON.parse(await readFile(LOGOS_FILE, "utf8")).logos ?? [] : [];

// An asset is a real file on disk — a bitmap or a clip — never something drawn
// in code. Video gets framework-owned playback via data-start/data-duration.
function logoMark(file, w, l, i, n) {
  const path = `media/logos/${file}`;
  const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(file);
  if (existsSync(path) && isVideo) {
    return `<video id="asset-${i}-${n}" class="logo-img logo-vid clip" src="logos/${file}" muted playsinline
            data-start="${q(l.at)}" data-duration="${q(l.dur)}" data-track-index="5"
            style="max-width:${w}px;max-height:${l.h ?? 480}px;width:auto;height:auto;visibility:hidden"></video>`;
  }
  if (existsSync(path)) {
    const cap = l.slot === "insert" || l.slot === "pip"
      ? `max-width:${w}px;max-height:${l.h ?? 480}px;width:auto;height:auto`
      : `width:${w}px`;
    return `<img class="logo-img" src="logos/${file}" alt="" style="${cap}" />`;
  }
  // Placeholder keeps the exact footprint the real asset will occupy.
  return `<span class="logo-ph" style="width:${w}px">${file.replace(/\.[a-z]+$/, "")}</span>`;
}

const logoHosts = CAPTIONS_ONLY ? "" : LOGOS.map((l, i) => {
  let slot = LOGO_SLOTS[l.slot] ?? LOGO_SLOTS.topleft;
  if (l.slot === "insert") {
    // Re-anchor the band so the asset centres on the guarded line.
    const c = guardInsertCentre(l);
    const half = (l.h ?? 480) / 2;
    slot = { left: 0, right: 0, top: Math.round(c - half), bottom: 0, align: "center" };
  }
  const files = l.files ?? [l.file];
  const pos = [
    slot.left !== undefined ? `left:${slot.left}px` : "",
    slot.right !== undefined ? `right:${slot.right}px` : "",
    slot.top !== undefined ? `top:${slot.top}px` : "",
    slot.bottom !== undefined ? `bottom:${slot.bottom}px` : "",
    slot.justify ? `justify-content:${slot.justify}` : "",
  ].filter(Boolean).join(";");
  const isVideoEntry = files.some((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
  const frame = l.slot === "insert" || l.slot === "pip" ? "logo-card logo-card--insert" : "logo-card";
  const marks = files
    .map((f, n) =>
      /\.(mp4|mov|webm|m4v)$/i.test(f)
        ? logoMark(f, l.w, l, i, n) // no frame wrapper: it would outlive the clip
        : `<span class="${frame}">${logoMark(f, l.w, l, i, n)}</span>`,
    )
    .join("\n          ");
  // Video entries get a plain positioned wrapper — the <video> inside owns the
  // timing. Image entries keep the timed host.
  return isVideoEntry
    ? `      <div class="logo-host" id="logo-${i}" style="${pos};align-items:${slot.align};">
          ${marks}
      </div>`
    : `      <div
        class="logo-host clip"
        id="logo-${i}"
        data-start="${q(l.at)}"
        data-duration="${q(l.dur)}"
        data-track-index="4"
        style="${pos};align-items:${slot.align};opacity:0;"
      >
          ${marks}
      </div>`;
}).join("\n\n");

// Marks rise in like any other element: 600ms expo, 180ms out.
// Blur is COMPENSATION FOR OCCLUSION, not decoration. An asset at the 3/4 line
// or in a top corner sits clear of the speaker's face, so the footage stays
// sharp — there is nothing to apologise for. Only a centre placement lands on
// the face, and there the blur explains why the face is covered.
//
// Applied to the <video> rather than its wrapper: the wrapper carries the PiP
// transforms and blurring it would bleed soft edges past the pill. The slight
// scale-up hides the edge sampling blur always produces.
// Only `center` blurs by default. Everything else clears the face. Per-entry
// `blur: N` opts in anywhere; `blur: 0` opts out.
const BLUR_FOR = { center: 8 };
const blurAmount = (l) => (l.blur !== undefined ? l.blur : (BLUR_FOR[l.slot] ?? 0));

const focusTweens = CAPTIONS_ONLY ? "" : LOGOS.map((l) => {
  const px = blurAmount(l);
  if (!px) return "";
  const outAt = q(l.at + l.dur - 0.4);
  return [
    `  tl.to('#bg-video', { filter: 'blur(${px}px)', scale: 1.04, duration: 0.5, ease: 'expo.out' }, ${q(l.at)});`,
    `  tl.to('#bg-video', { filter: 'blur(0px)', scale: 1, duration: 0.4, ease: 'power2.in' }, ${outAt});`,
  ].join("\n");
}).filter(Boolean).join("\n\n");

// ONE THING OWNS THE LOWER FRAME. An asset and a card cannot share the 3/4
// line: stacked, they fill the frame from the caption band up past the chin, and
// the talker disappears behind his own graphics. Lifting the card is not a fix —
// it just moves the collision onto the face. So the card hides for the duration
// of the asset and comes back after. Either the image or the card, never both.
const yieldTweens = CAPTIONS_ONLY ? "" : LOGOS.filter((l) => l.slot === "insert" || l.slot === "center")
  .flatMap((l) => {
    const from = l.at, to = l.at + l.dur;
    return CARDS.filter((c) => c.start < to && c.end > from).map((c) => {
      const host = `.card-host[data-card-id="${c.id}"]`;
      return [
        `  tl.to('${host}', { opacity: 0, duration: 0.4, ease: 'power2.in' }, ${q(from)});`,
        `  tl.to('${host}', { opacity: 1, duration: 0.5, ease: 'expo.out' }, ${q(to - 0.2)});`,
      ].join("\n");
    });
  })
  .join("\n\n");

const logoTimeline = LOGOS.map((l, i) => {
  const files = l.files ?? [l.file];
  if (files.some((f) => /\.(mp4|mov|webm|m4v)$/i.test(f))) return ""; // runtime-gated
  const sel = `#logo-${i}`;
  // The runtime gates .clip visibility itself, so only opacity/transform here.
  return [
    `  tl.fromTo('${sel}', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }, ${q(l.at)});`,
    `  tl.to('${sel}', { opacity: 0, duration: 0.18, ease: 'power2.in' }, ${q(l.at + l.dur - 0.18)});`,
  ].join("\n");
}).join("\n\n");

// ── one line, centred ─────────────────────────────────────────────────────
// Video headlines read best on a single centred line: a wrapped headline
// forces the eye to travel and re-anchor mid-beat. Rather than shortening the
// copy, size each headline to the measured card width and set nowrap.
// Space Grotesk 700 averages ~0.53em per glyph across Vietnamese mixed case;
// uppercase runs wider, so those get a heavier factor.
const CARD_INNER = W - 2 * (config.gutter ?? 56) - 2 * (config.cardPad ?? 44);

function fitSize(text, { max, min, upperMax }) {
  const clean = text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  const isUpper = clean === clean.toUpperCase();
  const per = isUpper ? 0.63 : 0.53;
  const cap = isUpper && upperMax ? upperMax : max;
  return Math.max(min, Math.min(cap, Math.floor(CARD_INNER / (clean.length * per))));
}

// Rewrite .title / .detail with a fitted font-size so both stay on one line.
function oneLine(html) {
  return html
    .replace(/<h1([^>]*?)class="title([^"]*)"([^>]*)>([\s\S]*?)<\/h1>/g, (m, a, mod, b, inner) => {
      const px = fitSize(inner, { max: 84, min: 38, upperMax: 76 });
      return `<h1${a}class="title${mod}"${b} style="font-size:${px}px">${inner}</h1>`;
    })
    .replace(/<p([^>]*?)class="detail"([^>]*)>([\s\S]*?)<\/p>/g, (m, a, b, inner) => {
      const px = fitSize(inner, { max: 34, min: 24 });
      return `<p${a}class="detail"${b} style="font-size:${px}px">${inner}</p>`;
    });
}

// Background layers for a dynamic band. Oversized so the drift never exposes
// an edge; both are transform-animated, which keeps them cheap and seek-safe.
const BG_LAYERS =
  '<div class="bg-grid"></div><div class="bg-glow"></div>';

// ── face guard ────────────────────────────────────────────────────────────
// face-zone.json is measured from the footage by face-zone.mjs (macOS Vision).
// Graphics are nudged to clear the face where geometry allows, and where it does
// not, the build says so rather than silently covering him.
//
// The eye line is the hard limit. A graphic across the chin is a normal
// lower-third; a graphic across the eyes kills the shot, so the guard protects
// the upper face absolutely and tolerates chin overlap when the alternative is
// pushing an asset into the caption band.
let FACE = null;
try {
  FACE = JSON.parse(await readFile("face-zone.json", "utf8")).zone;
} catch {
  /* no measurement — geometry falls back to the static face floor */
}
const EYE_LINE = FACE ? Math.round(FACE.top + (FACE.bottom - FACE.top) * 0.45) : null;
const guardLog = [];

function guardInsertCentre(l) {
  const h = l.h ?? 480;
  let centre = 1440; // the 3/4 line
  if (!EYE_LINE) return centre;
  const top = centre - h / 2;
  if (top >= EYE_LINE + 8) return centre;
  const wanted = EYE_LINE + 8 + h / 2;
  const maxCentre = 1680 - h / 2; // keep clear of the caption band
  if (wanted <= maxCentre) {
    guardLog.push(`  ${l.file ?? l.files?.[0]}: nudged down ${Math.round(wanted - centre)}px to clear the eye line`);
    return Math.round(wanted);
  }
  guardLog.push(
    `  ${l.file ?? l.files?.[0]}: cannot clear the eye line without entering the caption band — ` +
      `left at 3/4, overlaps the face by ${Math.round(EYE_LINE + 8 - top)}px (chin only)`,
  );
  return centre;
}

// ── captions ──────────────────────────────────────────────────────────────
// Word-level timings from transcript.json become 1-3 word chunks. Chunks are
// driven through ONE element with tl.set(innerHTML) rather than one clip per
// chunk: a 2.5-minute video is ~280 chunks, and 280 timed elements would blow
// past the timeline-density limit and slow every seek. A `set` is applied on
// seek, so scrubbing to any frame shows the right words.
const CAP = config.captions ?? null;
const CAP_ON = Boolean(CAP?.enabled);
let CAP_Y = CAP?.y ?? 384; // ~1/5 down the frame
if (FACE && CAP_Y + 80 > FACE.top) {
  const safe = Math.max(260, FACE.top - 96);
  guardLog.push(`  captions: raised ${CAP_Y - safe}px to stay off the face (face top ${FACE.top})`);
  CAP_Y = safe;
}
const CAP_MAX_WORDS = CAP?.maxWords ?? 3;
const CAP_SUPPRESS = CAP?.suppress ?? [];

let capSets = "";
if (CAP_ON) {
  const words = JSON.parse(await readFile(config.transcript ?? "transcript.json", "utf8"));

  // Anything sitting in the caption's column gets the line to itself. A
  // `topcenter` stack grows down into y 480, a `center` or `wall` asset owns the
  // frame, and a multi-file entry stacks lower than a single mark — in every
  // case the caption would either collide or fail contrast over a light plate.
  // Auto-suppress beats manual bookkeeping: the clash is derivable.
  const autoMuted = LOGOS.filter(
    (l) => ["topcenter", "center", "wall"].includes(l.slot) || (l.files?.length ?? 1) > 1,
  ).map((l) => [l.at - 0.3, l.at + l.dur + 0.3]);

  // Suppression exists because a card or a stacked mark was already showing
  // those words. In a captions-only pass there is nothing to collide with or
  // duplicate, so every chunk plays.
  const ranges = CAPTIONS_ONLY ? [] : [...CAP_SUPPRESS, ...autoMuted];
  const suppressed = (t) => ranges.some(([a, b]) => t >= a && t < b);

  // Chunk on: word count, terminal punctuation, or a pause over 0.35s. A pause
  // is a real phrase boundary — breaking there keeps chunks readable as units.
  const chunks = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const gap = next ? next.start - words[i].end : Infinity;
    const ends = /[.,!?…:]$/.test(words[i].text);
    if (cur.length >= CAP_MAX_WORDS || ends || gap > 0.35) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);

  // Highlight tokens that carry the fact — figures and latin product names.
  // Those are the words a viewer scans for, and the brand's yellow is the
  // emphasis colour, spent here per-word rather than per-card.
  // Highlight the fact, not every latin word. Vietnamese script is full of
  // undiacritised words ("chat", "hay", "local") that a naive latin test flags,
  // and once half the caption is yellow the yellow means nothing. So: figures,
  // or names carrying an internal capital (GPT, BGE, RTX, NVIDIA) — and at most
  // ONE per chunk.
  const isKey = (raw) => {
    const w = raw.replace(/[.,!?…:]$/, "");
    if (/\d/.test(w)) return true;
    return /[A-Z]/.test(w.slice(1)) || (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  };

  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [];
  for (const ch of chunks) {
    const at = ch[0].start;
    if (suppressed(at)) continue;
    let used = false;
    const html = ch
      .map((w) => {
        if (!used && isKey(w.text)) { used = true; return `<b>${esc(w.text)}</b>`; }
        return esc(w.text);
      })
      .join(" ");
    const out = ch[ch.length - 1].end;
    lines.push(`  tl.set('#caption', { innerHTML: '${html.replace(/'/g, "\\'")}' }, ${q(at)});`);
    // Clear at the end of the chunk only when a real gap follows, so captions
    // do not flicker off between adjacent chunks.
    lines.push(`  tl.set('#caption', { innerHTML: '' }, ${q(out + 0.001)});`);
  }
  capSets = lines.join("\n");
}

const captionEl = CAP_ON
  ? `      <div id="caption" class="caption" style="top:${CAP_Y}px"></div>`
  : "";

// ── emit ──────────────────────────────────────────────────────────────────
await mkdir(`${OUT}/cards`, { recursive: true });

const fragments = [];
for (const c of CARDS) {
  const surface = SURFACE[c.id] ?? c.surface ?? "white";
  const isBand = surface === "band" || surface === "band-dark";
  const isDynamic = surface === "band-dark";
  const cls = ["v-card", isDynamic ? "v-card--band v-card--band-dark" : isBand ? "v-card--band v-grid-surface" : `v-card--${surface}`]
    .filter(Boolean)
    .join(" ");
  const cardHtml = oneLine(c.html);
  const frag = `<div class="card" data-card-id="${c.id}" data-surface="${surface}">
  <style>
    .card[data-card-id="${c.id}"] .root {
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: transparent;
    }
  </style>
  <div class="root">${cardHtml
    .replace('<div class="wrap', `<div class="${cls}">${isDynamic ? BG_LAYERS : ""}<div class="wrap`)
    .replace(/<\/div>$/, "</div></div>")}
  </div>
</div>`;
  await writeFile(`${OUT}/cards/${c.id}.html`, frag + "\n");
  fragments.push({ id: c.id, frag });
}

const hosts = CAPTIONS_ONLY ? "" : CARDS.map((c) => {
  const f = fragments.find((x) => x.id === c.id).frag;
  return `      <div
        class="card-host clip"
        id="host-${c.id}"
        data-card-id="${c.id}"
        data-start="${q(c.start)}"
        data-duration="${q(c.end - c.start)}"
        data-track-index="2"
        style="left:0;top:0;width:${W}px;height:${H}px;visibility:hidden;opacity:0;"
      >
${f
  .split("\n")
  .map((l) => "        " + l)
  .join("\n")}
      </div>`;
}).join("\n\n");

// Moves default to the entry position if the config names none.
const PIP_MOVES = P.moves ?? [];
const firstPos = PIP_MOVES.length ? pipAt(PIP_MOVES[0].slot) : { x: PIP.x, y: PIP.y, w: PIP.width };

const pipMoveTweens = PIP_MOVES.slice(1)
  .map((m) => {
    const pos = pipAt(m.slot);
    const sc = m.scale ?? pipScale(pos);
    // 0.9s expo.inOut: slow enough to read as a camera move, not a jump cut.
    return `          tl.to('#video-wrap', { x: ${pos.x}, y: ${pos.y}, scale: ${sc}, duration: ${m.dur ?? 0.9}, ease: 'expo.inOut' }, ${q(m.at)});`;
  })
  .join("\n");

const pipTimeline = HAS_PIP && !CAPTIONS_ONLY
  ? `          tl.set('#video-wrap', { zIndex: 5 }, ${q(PIP_LIFT)});
          tl.set('#video-wrap', { className: 'video-wrapper pip-pill' }, ${q(PIP_LIFT)});
          tl.to('#video-wrap', { x: ${firstPos.x}, y: ${firstPos.y}, scale: ${pipScale(firstPos)}, duration: ${PIP_IN_DUR}, ease: 'expo.inOut' }, ${q(PIP_IN)});
${pipMoveTweens}
          tl.to('#video-wrap', { x: 0, y: 0, scale: 1, duration: ${PIP_OUT_DUR}, ease: 'expo.inOut' }, ${q(PIP_OUT)});
          tl.set('#video-wrap', { className: 'video-wrapper' }, ${q(PIP_DROP)});
          tl.set('#video-wrap', { zIndex: 0 }, ${q(PIP_DROP)});`
  : "";

const timeline = CAPTIONS_ONLY ? "" : CARDS.map((c) => compile(c, SURFACE[c.id] ?? c.surface ?? 'white')).join("\n\n");
const fontfaces = await readFile("_fontfaces.css", "utf8");

const backdropEl = `      <div
        id="pip-backdrop"
        class="clip"
        data-start="${q(BACKDROP.start)}"
        data-duration="${q(BACKDROP.end - BACKDROP.start)}"
        data-track-index="3"
        style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:var(--surface);z-index:1;visibility:hidden;"
      ></div>`;

const audioEl = OVERLAY
  ? ""
  : `      <audio
        id="source-audio"
        src="${VIDEO_SRC}"
        data-start="0"
        data-duration="${DUR}"
        data-track-index="10"
        data-volume="1"
      ></audio>
`;

const overlayGate = OVERLAY && !OVERLAY_SRC && !CAPTIONS_ONLY
  ? `
          tl.set('#video-wrap', { opacity: 0 }, 0);
          tl.set('#video-wrap', { opacity: 1 }, ${q(PIP_LIFT)});
          tl.set('#video-wrap', { opacity: 0 }, ${q(PIP_DROP)});`
  : "";

const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>GIGABYTE AI TOP ATOM — An À Ha video layer</title>
    <style>
${fontfaces.trimEnd()}

      /* ── An À Ha tokens (web v1.0 + video v1.1) ──────────────────────── */
      :root {
        --navy-950: #061225;
        --navy-900: #091a33;
        --blue-700: #1556d9;
        --blue-600: #246bfe;
        --blue-500: #3b82f6;
        --cyan-400: #24c8e5;
        --yellow-400: #ffca4f;
        --yellow-100: #fff1bd;
        --coral-500: #ff6c58;
        --ink: #0d1b2f;
        --muted: #58677d;
        --line: #dfe7f1;
        --surface: #f5f8fc;
        --white: #ffffff;

        /* video layer */
        --v-gutter: 56px;
        --v-safe-bottom: 310px;
        --v-text-stat: 200px;
        --v-text-display: 116px;
        --v-text-title: 84px;
        --v-text-title-sm: 64px;
        --v-text-lead: 40px;
        --v-text-body: 34px;
        --v-text-label: 24px;
        --v-card-radius: 28px;
        --v-card-pad: 44px;
        --v-shadow-card: 12px 15px 0 rgba(13, 27, 47, 0.1);
        --v-shadow-dark: 18px 20px 0 rgba(36, 107, 254, 0.28);
        --v-shadow-yellow: 12px 15px 0 rgba(255, 202, 79, 0.45);
        --v-grid-size: 64px;
        --v-grid-line: rgba(13, 27, 47, 0.055);
        --v-grid-line-dark: rgba(255, 255, 255, 0.06);
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0; padding: 0; width: 100%; height: 100%;
        overflow: hidden;
        background: ${OVERLAY ? "transparent" : "var(--navy-950)"};
        font-family: "Be Vietnam Pro", "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
      }
      #stage { position: relative; width: 100%; height: 100%; overflow: hidden; }

      .video-wrapper {
        position: absolute; left: 0; top: 0;
        width: ${W}px; height: ${H}px;
        overflow: hidden; z-index: 0; transform-origin: 0 0;
      }
      .video-wrapper video { width: 100%; height: 100%; object-fit: cover; }
      /* PiP keeps the brand's card language: radius + hard offset shadow.
         Chrome values are pre-divided by PIP_SCALE (${PIP_SCALE}). */
      .video-wrapper.pip-pill {
        border-radius: ${Math.round(24 / PIP_SCALE)}px;
        border: ${Math.round(8 / PIP_SCALE)}px solid var(--white);
        box-shadow: ${Math.round(14 / PIP_SCALE)}px ${Math.round(17 / PIP_SCALE)}px 0 rgba(36, 107, 254, 0.3);
      }

      /* Brand marks ride their own track above the cards. The white plate is
         the system's card at mark scale, so a logo reads as placed, not pasted. */
      /* Captions: one line, centred, ~1/4 down. Heavy shadow rather than a
         plate — a caption sits over a moving face and a box would fight the
         cards. Yellow marks the fact-carrying word, the brand's emphasis colour
         spent per-word here instead of per-card. */
      .caption {
        position: absolute;
        left: 90px;
        right: 90px;
        text-align: center;
        font: 800 62px/1.2 "Be Vietnam Pro", sans-serif;
        letter-spacing: -0.01em;
        color: var(--white);
        text-shadow: 0 4px 18px rgba(0, 0, 0, 0.85), 0 2px 4px rgba(0, 0, 0, 0.95);
        z-index: 6;
        pointer-events: none;
      }
      /* Brighter than the brand yellow-400: caption text is small and moving over
         footage, so it needs more luminance than a large card element does. */
      .caption b { color: #ffe24d; font-weight: 800; }

      .logo-host { position: absolute; display: flex; flex-direction: column; gap: 18px; z-index: 3; pointer-events: none; }
      .logo-card {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 18px 24px;
        background: var(--white);
        border: 2px solid var(--line);
        border-radius: 18px;
        box-shadow: var(--v-shadow-card);
      }
      .logo-img { display: block; height: auto; }
      /* Evidence frame: the same card language as everything else, sized for an
         asset you are meant to read rather than glance at. */
      .logo-card--insert { padding: 12px; border-radius: 22px; box-shadow: var(--v-shadow-dark); }
      .logo-card--insert .logo-img { border-radius: 12px; }
      /* Video assets carry their own frame: the wrapper is untimed, so a frame
         on it would sit on screen after the clip ended. */
      .logo-vid {
        border: 12px solid var(--white);
        border-radius: 22px;
        box-shadow: var(--v-shadow-dark);
      }
      .logo-ph {
        display: inline-flex; align-items: center; justify-content: center;
        height: 92px;
        font: 700 30px "Space Grotesk", sans-serif;
        letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--ink);
        border: 3px dashed var(--muted);
        border-radius: 10px;
      }

      .card-host { position: absolute; pointer-events: none; overflow: hidden; z-index: 2; }
      .card-host .card { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .card-host .char { display: inline-block; visibility: visible; }

      /* ── card family ──────────────────────────────────────────────────
         The v1.0 .brand-card at video scale. The card sits in the lower
         stage, below the face floor, so it never covers the speaker. */
      .v-card {
        position: absolute;
        left: var(--v-gutter);
        right: var(--v-gutter);
        bottom: var(--v-safe-bottom);
        padding: var(--v-card-pad);
        border: 2px solid var(--line);
        border-radius: var(--v-card-radius);
        background: var(--white);
        color: var(--ink);
        box-shadow: var(--v-shadow-card);
        --accent: var(--blue-600);
        --face: var(--ink);
        --sub: var(--muted);
        --chipbg: var(--ink);
        --chipink: var(--white);
      }
      .v-card--blue { border-color: rgba(36, 107, 254, 0.22); background: #edf4ff; }
      .v-card--yellow {
        border-color: rgba(255, 202, 79, 0.55);
        background: #fff7d8;
        box-shadow: var(--v-shadow-yellow);
      }
      /* Translucent panel: keeps the footage legible behind the copy. Same
         geometry and shadow as the solid cards — only the fill changes. Use it
         when what is happening on camera still matters; use a solid card when
         the words are the whole point. */
      .v-card--glass {
        border-color: rgba(255, 255, 255, 0.18);
        /* An alpha overlay has nothing behind the card to sample, so
           backdrop-filter cannot work there — and once the overlay is
           composited in an NLE the blur still cannot reach the footage. It also
           makes Page.captureScreenshot time out on the alpha path. So: blur for
           the baked render, a slightly denser flat fill for the overlay. */
        background: ${OVERLAY ? "rgba(9, 26, 51, 0.78)" : "rgba(9, 26, 51, 0.66)"};
        ${OVERLAY ? "" : "backdrop-filter: blur(16px);\n        -webkit-backdrop-filter: blur(16px);"}
        color: var(--white);
        box-shadow: var(--v-shadow-dark);
        --accent: var(--yellow-400);
        --face: var(--white);
        --sub: #c6d6ea;
        --chipbg: var(--blue-600);
        --chipink: var(--white);
      }
      .v-card--dark {
        border-color: rgba(255, 255, 255, 0.14);
        background: var(--navy-900);
        color: var(--white);
        box-shadow: var(--v-shadow-dark);
        --accent: var(--yellow-400);
        --face: var(--white);
        --sub: #a9bcd6;
        --chipbg: var(--blue-600);
        --chipink: var(--white);
      }
      /* The benchmark chapter is a full-frame band, not a floating card. */
      .v-card--band {
        position: absolute;
        left: 0; right: 0; top: 0; bottom: 0;
        display: flex; align-items: center;
        padding: 980px var(--v-gutter) var(--v-safe-bottom);
        border: 0; border-radius: 0;
        background: var(--surface);
        box-shadow: none;
      }
      /* Full-frame dark band with a living background: a drifting graph-paper
         grid plus a slow blue glow crossing behind the content. The grid is the
         web system's .brand-grid-surface at video scale. */
      .v-card--band-dark {
        /* This band owns the whole frame — no PiP to dodge, so it centres in
           the full safe area rather than the benchmark band's lower window. */
        padding: 250px var(--v-gutter) var(--v-safe-bottom);
        background: var(--navy-950);
        color: var(--white);
        --accent: var(--yellow-400);
        --face: var(--white);
        --sub: #a9bcd6;
        --chipbg: var(--blue-600);
        --chipink: var(--white);
        overflow: hidden;
      }
      .v-card--band-dark .bg-grid {
        position: absolute;
        left: -128px; top: -128px;
        width: calc(100% + 256px); height: calc(100% + 256px);
        background-image: linear-gradient(var(--v-grid-line-dark) 2px, transparent 2px),
          linear-gradient(90deg, var(--v-grid-line-dark) 2px, transparent 2px);
        background-size: 128px 128px;
        z-index: 0;
      }
      .v-card--band-dark .bg-glow {
        position: absolute;
        left: 50%; top: 50%;
        width: 1200px; height: 1200px;
        margin: -600px 0 0 -600px;
        background: radial-gradient(circle, rgba(36,107,254,0.42) 0%, rgba(36,107,254,0.13) 42%, transparent 68%);
        z-index: 0;
      }
      .v-card--band-dark .wrap { position: relative; z-index: 1; }
      /* A numbered list centres as a block, not row by row: per-row centring
         puts 01/02/03/04 at four different x positions and the column reads
         ragged. The group stays centred; the rows align inside it. */
      /* This scene owns the whole frame, so it gets frame-scale type, not the
         card-scale type a lower-third uses. Roughly 2x the in-card sizes. */
      .v-card--band-dark .kicker { font-size: 30px; padding: 16px 26px; }
      .v-card--band-dark .rownum { font-size: 34px; }
      .v-card--band-dark .rowmodel { font-size: 84px; line-height: 1.06; }
      .v-card--band-dark .rowrole { font-size: 44px; line-height: 1.25; }
      .v-card--band-dark .rows { width: auto; align-items: flex-start; gap: 52px; }
      .v-card--band-dark .rowbody { gap: 10px; }
      .v-card--band-dark .row { gap: 26px; }
      .v-card--band-dark .wrap { gap: 48px; }
      .v-card--band-dark .row { justify-content: flex-start; }
      .v-card--band-dark .rowbody { align-items: flex-start; text-align: left; }

      .v-grid-surface {
        background-image: linear-gradient(var(--v-grid-line) 1px, transparent 1px),
          linear-gradient(90deg, var(--v-grid-line) 1px, transparent 1px);
        background-size: var(--v-grid-size) var(--v-grid-size);
      }

      .wrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 26px; width: 100%; }
      /* Headlines are sized to fit one line (see oneLine()), so nothing wraps. */
      .title, .detail { white-space: nowrap; }
      .rows { align-items: center; }
      .row { justify-content: center; }
      .rowbody { align-items: center; text-align: center; }
      .chips, .statrow, .bigmetric, .metricval, .signoff, .specline { justify-content: center; }
      .metric, .signoff { align-items: center; }
      .cta, .badge, .revealbox, .kicker { align-self: center; }
      .bar { margin: 0 auto; }
      .v-card--band .wrap { gap: 32px; }
      .v-card--band { justify-content: center; }

      /* ── type ─────────────────────────────────────────────────────────
         Both faces cover Vietnamese, so headlines keep Space Grotesk. */
      .kicker {
        font: 700 var(--v-text-label)/1 "Be Vietnam Pro", sans-serif;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        background: var(--chipbg);
        color: var(--chipink);
        padding: 13px 19px;
        border-radius: 10px;
      }
      .title {
        margin: 0;
        font: 700 var(--v-text-title)/1.08 "Space Grotesk", sans-serif;
        letter-spacing: -0.025em;
        color: var(--face);
      }
      .title.small { font-size: var(--v-text-title-sm); }
      .detail { margin: 0; font: 400 var(--v-text-body)/1.45 "Be Vietnam Pro", sans-serif; color: var(--sub); }
      .detail b { color: var(--face); font-weight: 600; }
      .rule { height: 8px; width: 0; background: var(--accent); border-radius: 999px; }

      .chips { display: flex; flex-wrap: wrap; gap: 14px; }
      .chip {
        font: 600 26px/1 "Space Grotesk", sans-serif;
        background: var(--blue-600);
        color: #fff;
        padding: 15px 21px;
        border-radius: 12px;
      }
      .chip.ghost { background: transparent; color: var(--sub); box-shadow: inset 0 0 0 2px var(--line); }
      .v-card--dark .chip.ghost { box-shadow: inset 0 0 0 2px rgba(255,255,255,.22); }
      .chips.big .chip { font-size: 34px; padding: 19px 27px; }

      .statrow { display: flex; align-items: center; gap: 32px; }
      .stat { font: 700 var(--v-text-stat)/1.02 "Space Grotesk", sans-serif; letter-spacing: -0.04em; color: var(--accent); }
      .statside { display: flex; flex-direction: column; gap: 16px; }
      .statlabel { font: 700 40px/1.15 "Space Grotesk", sans-serif; letter-spacing: -0.02em; color: var(--face); }

      .specline { display: flex; align-items: center; gap: 18px; }
      .tag {
        font: 700 20px/1 "Be Vietnam Pro", sans-serif;
        letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--sub);
        box-shadow: inset 0 0 0 2px var(--line);
        padding: 11px 15px; border-radius: 8px;
      }
      .specval { font: 600 38px/1.2 "Space Grotesk", sans-serif; color: var(--face); }
      .revealbox { background: var(--blue-600); color: #fff; padding: 26px 32px; border-radius: 18px; box-shadow: var(--v-shadow-dark); }
      .revealsmall { font: 400 24px/1 "Be Vietnam Pro", sans-serif; opacity: 0.85; margin-bottom: 10px; }
      .revealbig { font: 700 62px/1.05 "Space Grotesk", sans-serif; letter-spacing: -0.025em; }

      .badge {
        font: 700 76px/1 "Space Grotesk", sans-serif; letter-spacing: -0.03em;
        background: var(--blue-600); color: #fff;
        padding: 22px 30px; border-radius: 20px;
        box-shadow: var(--v-shadow-dark);
      }

      .rows { display: flex; flex-direction: column; gap: 20px; width: 100%; }
      .rows.tight { gap: 16px; }
      .row { display: flex; align-items: baseline; gap: 18px; }
      .rownum { font: 700 24px/1 "Space Grotesk", sans-serif; color: var(--accent); }
      .rowbody { display: flex; flex-direction: column; gap: 4px; }
      .rowmodel { font: 700 38px/1.1 "Space Grotesk", sans-serif; letter-spacing: -0.02em; color: var(--face); }
      .rowrole { font: 400 29px/1.3 "Be Vietnam Pro", sans-serif; color: var(--sub); }
      .rowrole.big { font-size: 38px; font-weight: 500; color: var(--face); }
      .dot { width: 16px; height: 16px; border-radius: 999px; background: var(--accent); flex: none; }

      /* ── data viz ─────────────────────────────────────────────────────
         Bars and figures are drawn from the numbers, never screenshotted. */
      .bigmetric { display: flex; align-items: baseline; gap: 14px; }
      .bignum { font: 700 180px/1.25 "Space Grotesk", sans-serif; letter-spacing: -0.04em; color: var(--blue-600); }
      .bignum.sm { font-size: 120px; }
      .bignum.xl { font-size: var(--v-text-stat); }
      .metric.alt .bignum { color: var(--ink); }
      .bigunit { font: 700 44px/1 "Space Grotesk", sans-serif; color: var(--ink); }
      .bigunit.xl { font-size: 70px; }
      .v-card--dark .bignum, .v-card--dark .bigunit { color: var(--yellow-400); }
      .v-card--dark .bigunit { color: var(--white); }

      .bar { width: 900px; height: 30px; background: #e4ecf7; border-radius: 999px; overflow: hidden; }
      .barfill { width: 0; height: 100%; background: var(--blue-600); border-radius: 999px; }
      .barmeta { font: 400 31px/1.3 "Be Vietnam Pro", sans-serif; color: var(--muted); }
      .barmeta b { color: var(--ink); font-weight: 600; }

      .metric { display: flex; flex-direction: column; gap: 6px; }
      .metricval { display: flex; align-items: baseline; gap: 12px; }
      .metriclabel { font: 400 31px/1.3 "Be Vietnam Pro", sans-serif; color: var(--muted); }

      .signoff { display: flex; flex-direction: column; gap: 16px; }
      .signname { font: 700 140px/1.05 "Space Grotesk", sans-serif; letter-spacing: -0.045em; color: var(--face); }
      .signdetail { font: 400 33px/1.3 "Be Vietnam Pro", sans-serif; color: var(--sub); }
      .cta {
        font: 700 42px/1 "Space Grotesk", sans-serif; letter-spacing: 0.1em;
        background: var(--blue-600); color: #fff;
        padding: 22px 36px; border-radius: 14px;
        box-shadow: var(--v-shadow-dark);
      }
    </style>
  </head>
  <body>
    <div
      id="stage"
      data-composition-id="talking-head-recut"
      data-start="0"
      data-duration="${DUR}"
      data-fps="${FPS}"
      data-width="${W}"
      data-height="${H}"
    >
${CAPTIONS_ONLY ? "" : `      <div class="video-wrapper" id="video-wrap">
        <video
          id="bg-video"
          src="${OVERLAY && OVERLAY_SRC ? OVERLAY_SRC : VIDEO_SRC}"
          muted
          playsinline
          data-start="${OVERLAY && OVERLAY_SRC ? q(PIP_LIFT) : "0"}"
          data-duration="${OVERLAY && OVERLAY_SRC ? q(PIP_DROP - PIP_LIFT) : DUR}"
          data-track-index="1"
        ></video>
      </div>`}
${HAS_PIP && !CAPTIONS_ONLY ? backdropEl : ''}
${captionEl}

${audioEl}
${hosts}

${logoHosts}

      <script src="vendor/gsap.min.js"></script>
      <script>
        (function () {
          window.__fmt = function (v, fmt) {
            if (typeof fmt === 'string' && /^\\.[0-9]+f$/.test(fmt)) {
              return Number(v).toFixed(Number(fmt.slice(1, -1)));
            }
            if (fmt === ',d') return Math.round(v).toLocaleString();
            return String(Math.round(v));
          };

          var tl = window.gsap.timeline({ paused: true });

${timeline}

${logoTimeline}

${yieldTweens}

${focusTweens}

${capSets}

${HAS_PIP ? pipTimeline : ''}${overlayGate}

          window.__timelines = window.__timelines || {};
          window.__timelines['talking-head-recut'] = tl;
        })();
      </script>
    </div>
  </body>
</html>
`;

await writeFile(`${OUT}/index.html`, html);
if (FACE) {
  console.log(`face zone: y ${FACE.top}-${FACE.bottom}, eye line ${EYE_LINE} (${FACE.detectedIn})`);
  console.log(guardLog.length ? guardLog.join("\n") : "  no graphics needed nudging");
}
console.log(`wrote ${CARDS.length} cards + ${OUT}/index.html (${(html.length / 1024).toFixed(1)} KB)${OVERLAY ? " [alpha]" : ""}`);
