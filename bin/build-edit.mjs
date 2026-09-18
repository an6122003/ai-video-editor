#!/usr/bin/env node
// Nowa 16:9 composition builder — the renderer layer. Reads the director's
// edit-plan.json and emits ONE self-contained HyperFrames composition:
// A-roll base, B-roll cutaways trimmed from the 4K library, motion-graphic
// cards drawn in the Nowa design system, karaoke captions.
//
//   node bin/build-edit.mjs [--plan edit-plan.json] [--out build] [--force] [--no-captions]
//
// Run from the project directory. Inputs it expects there:
//   project.json           brand, composition size, fps
//   edit-plan.json         beats with visual decisions (schema at the bottom of this file)
//   broll/index.json       the described B-roll library (clip id -> source path)
//   work/transcript.clean.json   words on the clean A-roll timeline
//   _fontfaces.css + fonts/      from `fetch-fonts.mjs --brand nowa`
//
// Design system: system/nowa (tokens.css, brand/). Rules this file enforces:
//   - stepped pixel corners (clip-path) on every drawn surface, hard offset
//     shadows (drop-shadow, never blur), Onest headings / Noto Sans body,
//     Tiny5 only for the eyebrow label
//   - ONE coral per view: the card on screen owns coral; a caption may use
//     the coral highlight only when no card is visible
//   - day / night rhythm: cards alternate white and deep-ink faces unless the
//     plan says otherwise
//   - motion: translateY + opacity entrances on expo-out (700ms), exits ~75%
//     of the entrance, transform/opacity only — the runtime owns visibility
import { readFile, writeFile, mkdir, link, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hwaccelArgs } from "./lib/hwaccel.mjs";

const run = promisify(execFile);
// Listed-on-trust rather than probed: both cutting loops already retry in
// software, so a device that lists and then fails costs one attempt, not the build.
const HW = await hwaccelArgs(null);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const project = JSON.parse(await readFile("project.json", "utf8"));
// A deliverable plan may EXTEND the master edit: the vertical cut is the same
// argument in a different frame, and two copies of 22 beats would drift apart
// within one revision. The child overrides top-level keys, and `beatOverrides`
// patches individual beats by id — which is what anything measured in frame
// coordinates needs, since a 9:16 crop of the same shot puts it somewhere else.
// A deliverable plan may EXTEND another: the vertical cut is the same argument in
// a different frame, and the Shorts cut is that vertical again over a shorter
// A-roll. Two or three copies of 22 beats would drift apart within one revision.
// The chain resolves base-first, each level overriding top-level keys and
// patching individual beats by id through `beatOverrides` — which is what
// anything measured in frame coordinates needs, and how a level drops a beat
// (`"b12": null`) whose spoken anchor no longer exists in its cut.
const loadPlan = async (path, seen = new Set()) => {
  if (seen.has(path)) throw new Error(`plan chain loops back to ${path}`);
  seen.add(path);
  const own = JSON.parse(await readFile(path, "utf8"));
  if (!own.extends) return own;
  const base = await loadPlan(own.extends, seen);
  const { extends: _x, beatOverrides = {}, ...rest } = own;
  const merged = { ...base, ...rest };
  const unknown = Object.keys(beatOverrides).filter((id) => !merged.beats.some((b) => b.id === id));
  if (unknown.length) throw new Error(`${path}: beatOverrides names beats that are not in the chain: ${unknown.join(", ")}`);
  merged.beats = merged.beats
    .map((b) => {
      const o = beatOverrides[b.id];
      if (o === undefined) return b;
      if (o === null) return null;
      return { ...b, ...o, card: b.card && o.card ? { ...b.card, ...o.card } : (o.card ?? b.card) };
    })
    .filter(Boolean);
  return merged;
};
const plan = await loadPlan(flag("--plan", "edit-plan.json"));
const index = JSON.parse(await readFile("broll/index.json", "utf8"));
const clipById = new Map(index.clips.map((c) => [c.id, c]));

const OUT = flag("--out", plan.outDir ?? "build");
// The composition is a property of the DELIVERABLE, not the project: the same
// plan builds 16:9 and 9:16. Plan overrides project; --composition overrides both.
const COMP = { ...(project.composition ?? {}), ...(plan.composition ?? {}) };
{
  const c = flag("--composition", null);
  if (c) { const m = /^(\d+)x(\d+)$/.exec(c.trim()); if (!m) throw new Error(`--composition wants WxH, got "${c}"`);
    COMP.width = +m[1]; COMP.height = +m[2]; }
}
const W = COMP.width ?? 1920;
const H = COMP.height ?? 1080;
const FPS = COMP.fps ?? 30;
const q = (t) => (Math.round(t * FPS) / FPS).toFixed(4);

// ── the frame ─────────────────────────────────────────────────────────────
// Portrait is not landscape with different numbers: a 680px panel beside a face
// works at 1920 wide and is a sliver at 1080, so the geometry is derived and a
// few rules change outright (see VERT_LAYOUT and the band below).
const VERT = H > W;
const GUTTER = Math.round(W * 0.0375);                  // 72 @1920, 40 @1080
const PANEL_W = VERT ? W - 2 * GUTTER : 680;            // portrait panels are full-width
const TOP_SAFE = VERT ? Math.round(H * 0.099) : 96;     // 190 @1920 tall
// Landscape: BOT_SAFE clears the caption band (y≈958–1016). Portrait has two
// separate things to clear and they are not the same size:
//   CAP_BOTTOM  where the caption's own bottom edge sits. TikTok and Reels put
//               the username, description and buttons over roughly the bottom
//               fifth of the frame, so the caption has to finish above that or
//               the platform draws its own text on top of ours.
//   BOT_SAFE    the strip no CARD may enter — the platform UI plus room for up
//               to three lines of caption above it.
const CAP_BOTTOM = VERT ? Math.round(H * 0.20) : 64;      // 384 @1920 tall
const BOT_SAFE = VERT ? Math.round(H * 0.20) : 180;       // 384 @1920 tall
// Portrait puts the caption ABOVE the speaker and the cards in the band below
// him, so neither ever crosses his face. "bottom" keeps the landscape habit.
const CAP_POS = VERT ? (plan.captionPos ?? "top") : "bottom";
// Where the caption's TOP edge sits when it is above him, as a fraction of the
// frame. Pinned to the frame's top edge it read as crammed; this gives it a
// margin and lets it grow downward over his hair rather than upward off-frame.
// plan.captionY to taste.
const CAP_TOP_Y = Math.round(H * (plan.captionY ?? 0.105));
// Filled in once the band is known (portrait) — the strip of frame a panel may
// occupy. In landscape a panel shares the frame with the speaker; in portrait it
// has its own room, and `v` means top/mid/bottom OF THAT ROOM.
//
// `mid` differs between the two on purpose. In landscape it is the FRAME's
// centre: a panel beside a face wants the optical middle of the shot, and
// centring it in the safe area instead would shift every mid panel in every
// delivered 16:9 edit up by 42px — a portrait feature has no business moving a
// landscape cut. In portrait `mid` is the zone's centre, because the zone is
// the only room the panel has.
let ZONE = { top: TOP_SAFE, bot: H - BOT_SAFE };
const midY = (h, Z = ZONE) => (VERT ? Math.round((Z.top + Z.bot - h) / 2) : Math.round((H - h) / 2));
const defaultSide = () => ((FACE.x0 + FACE.x1) / 2 >= W / 2 ? "left" : "right");

// A start/duration pair for the runtime. Rounding the two independently drifts:
// 569/30 prints 18.9667 and 86/30 prints 2.8667, whose sum is 21.8334 — one
// ten-thousandth past the next clip's printed 21.8333, which the runtime reads
// as overlapping clips on one track. So round the two ENDPOINTS and let the
// duration be their difference; then printed start + printed duration is
// exactly the next printed start.
const startDur = (at, dur) => {
  const s = +q(at), e = +q(at + dur);
  return [s.toFixed(4), (+(e - s).toFixed(4)).toFixed(4)];
};
const warn = [];
const swapped = [];   // portrait layout substitutions, reported at the end

// ── sources ───────────────────────────────────────────────────────────────
const AROLL = plan.aroll ?? "out/01_aroll_clean.mp4";
const probeDur = async (f) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout.trim());
const probeSize = async (f) => {
  const o = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", f])).stdout.trim();
  const [w, h] = o.split("x").map(Number);
  return { w, h };
};
const AROLL_DUR = plan.arollDuration ?? (await probeDur(AROLL));
const AROLL_SIZE = await probeSize(AROLL);
// ── the A-roll band (portrait only) ───────────────────────────────────────
// In a portrait frame the talking head is a window on the brand ground, not the
// ground itself. That is a quality decision as much as a design one: this source
// is really 1280x720, so a full-bleed 9:16 crop would upscale his face 2.67x —
// softer than the 16:9 cut. A band sized to the source's own height shows it at
// 1:1 instead, and the rest of the frame becomes the room the cards never had.
//
//   scale = arollAspect * bandH / sourceRealWidth
//
// so bandH = realW / arollAspect puts it at exactly 1:1. Cap at 46% of the frame
// so the band can never crowd out the card zone, and report the scale either way
// rather than let an upscale pass unnoticed.
const AROLL_ASPECT = AROLL_SIZE.w / AROLL_SIZE.h;
const SRC_SIZE = project.source?.aroll ? await probeSize(project.source.aroll).catch(() => AROLL_SIZE) : AROLL_SIZE;
// Portrait shows the talking head one of two ways:
//   "full"  the reference look — crop to the speaker, footage fills the frame,
//           cards overlay it. Costs an upscale on a small source (see below).
//   "band"  the footage at 1:1 in a window, cards in the room underneath.
// Full-bleed is the default because it is what a vertical feed expects.
const AROLL_FIT = !VERT ? "full" : (plan.arollFit ?? "full");
const BANDED = VERT && AROLL_FIT === "band";
const BAND = !BANDED ? null : (() => {
  const oneToOne = Math.round(SRC_SIZE.w / AROLL_ASPECT);
  const h = plan.band?.h ?? Math.min(oneToOne, Math.round(H * 0.46));
  const y = plan.band?.y ?? TOP_SAFE + 40;
  // What the viewer actually gets: real pixels per CSS pixel across the band.
  const scale = (AROLL_ASPECT * h) / SRC_SIZE.w;
  return { y, h, scale, oneToOne, sideCropPct: Math.max(0, 100 * (1 - (W / (h * AROLL_ASPECT)))) };
})();
if (BAND) ZONE = { top: BAND.y + BAND.h + 40, bot: H - BOT_SAFE };
if (BAND && BAND.scale > 1.05) warn.push(`BAND: the band is ${BAND.h}px tall, which upscales a ${SRC_SIZE.w}x${SRC_SIZE.h} source ${BAND.scale.toFixed(2)}x. ${BAND.oneToOne}px would be 1:1 — set plan.band.h.`);

const TAIL = plan.tail ?? (plan.beats.some((b) => b.card?.type === "endcard") ? 3 : 0);
const DUR = +(AROLL_DUR + TAIL).toFixed(3);

await mkdir(join(OUT, "broll"), { recursive: true });
await mkdir(join(OUT, "fonts"), { recursive: true });
await mkdir(join(OUT, "brand"), { recursive: true });

// Hardlink where we can (same volume, instant, no second copy of 600MB);
// copy where we cannot.
async function place(src, dst) {
  if (existsSync(dst)) return;
  try { await link(src, dst); } catch { await copyFile(src, dst); }
}
// ── the A-roll the composition plays ─────────────────────────────────────
// Landscape plays the file as it is. Portrait full-bleed must crop it to 9:16
// and scale it up, and doing that HERE rather than leaving it to the browser is
// the whole difference between an acceptable picture and a soft one: the
// renderer scales a video element bilinearly, while ffmpeg will do it with
// lanczos and let us put a little sharpening back afterwards. One pass, cached.
const AROLL_OUT = join(OUT, "aroll.mp4");
if (!VERT || BANDED) {
  await place(AROLL, AROLL_OUT);
} else if (!existsSync(AROLL_OUT)) {
  // Crop the widest 9:16 the file will give (full height), then up to frame size.
  const cw = Math.round((AROLL_SIZE.h * W) / H / 2) * 2;
  const chain = plan.arollFilter ??
    `crop=${cw}:${AROLL_SIZE.h}:(iw-${cw})/2:0,scale=${W}:${H}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0`;
  const real = Math.round((SRC_SIZE.h * W) / H);
  process.stdout.write(`  scaling the A-roll to ${W}x${H}: crop ${cw}x${AROLL_SIZE.h} of ${AROLL_SIZE.w}x${AROLL_SIZE.h}` +
    ` (${real}x${SRC_SIZE.h} real pixels, ${(W / real).toFixed(2)}x) ... `);
  const t0 = Date.now();
  const argv = ["-y", "-v", "error", "-i", AROLL, "-vf", chain,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-g", String(FPS), "-keyint_min", String(FPS),
    "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", AROLL_OUT];
  try { await run("ffmpeg", argv, { maxBuffer: 1 << 26 }); }
  catch (e) { console.log("failed"); throw e; }
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
// GSAP is not served by the runtime — the composition must ship it. Without
// this file the timeline script throws on load and every card stays invisible.
await mkdir(join(OUT, "vendor"), { recursive: true });
const gsapSrc = join(REPO, "node_modules/gsap/dist/gsap.min.js");
if (!existsSync(gsapSrc)) { console.error("gsap not installed — run `npm install` in the repo root"); process.exit(1); }
await copyFile(gsapSrc, join(OUT, "vendor/gsap.min.js"));
for (const f of await readdir("fonts")) await place(join("fonts", f), join(OUT, "fonts", f));
for (const f of ["nowa-wordmark.svg", "nowa-wordmark-pastel.svg"]) await place(join(REPO, "system/nowa/brand", f), join(OUT, "brand", f));
const fontfaces = await readFile("_fontfaces.css", "utf8");

// ── geometry ──────────────────────────────────────────────────────────────
// The speaker sits right of centre in this framing, so the left third is the
// default home for cards. plan.face overrides the measured default; a card
// may still name its side.
const FACE = plan.face ?? { x0: 980, y0: 150, x1: 1200, y1: 620 };
const panelX = (side) => (side === "right" ? W - GUTTER - PANEL_W : GUTTER);

// Types that own the whole frame. Captions are suppressed under these, and
// they count as covering the footage for the baked-cutaway check.
const FULL_FRAME = new Set(["endcard", "statement", "list", "compare", "quote", "plate"]);
// ...except where a layout of that type is deliberately panel-sized.
const PANEL_LAYOUTS = { plate: new Set(["inset", "slides"]), list: new Set(["panel"]) };
// Panel layouts that read left-to-right and need more than a third of the frame.
const WIDE_LAYOUT = new Set(["timeline:track", "process:chips"]);
const isFull = (c) => FULL_FRAME.has(c.type) && !PANEL_LAYOUTS[c.type]?.has(c.layout);
// Types that draw over the footage without a surface of their own.
const OVERLAY = new Set(["annotate", "cells"]);

// The layout used when a card names none.
const DEFAULT_LAYOUT = {
  "lower-third": "bar", bignum: "panel", list: "rows", checklist: "rows", process: "chips",
  callout: "panel", timeline: "rows", statement: "masked", quote: "rail", compare: "columns",
  plate: "frame", endcard: "center", annotate: "mark", cells: "row",
};

// Side by side does not survive a 1080-wide frame — two columns become two
// slivers, and a rail of three stops becomes unreadable. Each of these has a
// stacked sibling of the same type, so a plan written once produces both
// formats without a second set of cards to keep in step. `plate` is absent on
// purpose: its scene grid stacks in CSS, which keeps the ink/coral blocks and
// the framed picture the reference mockups asked for.
const VERT_LAYOUT = {
  "compare:columns": "stack", "compare:versus": "stack", "compare:bars": "stack",
  "bignum:split": "stack", "bignum:fraction": "stack",
  "list:columns": "rows", "list:grid": "rows", "list:index": "rows",
  "timeline:track": "rows",
  "process:chips": "rail",
  "checklist:grid": "rows",
  "endcard:split": "center",
  "quote:rail": "card",
};

// Each list layout carries its own row element, so a reveal times to the word
// whichever layout the card ends up using.
const LIST_ITEM = {
  rows: ".li", panel: ".lp-row", grid: ".lg-cell", stack: ".ls-mask", chips: ".lc-chip",
  index: ".lx-row", steps: ".lst-row", columns: ".lco-col",
};

// When a card reveals its items on the words, the reveal owns their entrance and
// the generic .el stagger must keep its hands off them. Every one of these row
// elements also carries `el`, so without this the stagger's opacity:1 at at+0.12
// undid the reveal's opacity:0 at at — the items all appeared with the card and
// then sat still, which is the exact failure the reveals exist to prevent.
// compare and process are absent on purpose: their targets carry no `el`, and
// timeline's reveal only recolours a dot the stagger has already brought in.
const revealOwns = (c) => {
  if (!c.reveal?.length) return null;
  if (c.type === "list") return LIST_ITEM[c.layout] ?? ".li";
  if (c.type === "checklist") return ".check";
  if (c.type === "statement" && c.layout === "blocks") return ".stb";
  return null;
};

// ── the rhythm rules ──────────────────────────────────────────────────────
// The floors and ceilings below are the house rules. A project may set a
// STYLE (bin/style.mjs writes project.style) because a product discussion and
// a casual monologue are not the same kind of video and should not be held to
// one cadence. Precedence, loosest to tightest:
//
//   these defaults  ->  project.style.rhythm  ->  plan.rhythm  ->  per-beat
//
// so a style sets the temperature, a plan overrides any single number, and one
// beat can still do whatever that beat needs.
const RHYTHM = { ...(project.style?.rhythm ?? {}), ...(plan.rhythm ?? {}) };
// A cutaway shorter than this reads as a flinch, not a cut: the eye needs
// ~0.4s to leave the speaker, ~0.4s to come back, and something to look at in
// between. Insets are gentler — the speaker never leaves — so they can be
// shorter. Enforced below by extending into available room, and dropping the
// shot outright if the room isn't there: no cutaway beats a flashed one.
const HOLD = { full: RHYTHM.minFull ?? 3.2, inset: RHYTHM.minInset ?? 2.2, wall: 3.2 };
// A stretch of unbroken talking head longer than this needs something.
const MAX_BARE = RHYTHM.maxBare ?? 20;
// Share of runtime with neither B-roll nor a card on screen.
const MAX_UNAUGMENTED = RHYTHM.maxUnaugmented ?? 0.5;
// No single card type may dominate, and three of a kind in a row is a rut.
const MAX_TYPE_SHARE = 0.34, MAX_TYPE_RUN = 2;
// A full-frame card takes the speaker off screen. Past a quarter of the runtime
// the video stops being a person talking and becomes a slideshow with narration.
const MAX_FULL_SHARE = RHYTHM.maxFullFrame ?? 0.25;
// Two takeovers back to back means the speaker vanishes for half a minute.
const MAX_FULL_RUN = 1;
// A card with nothing timed to the words is a still frame. Past this it needs
// progressive reveals or a shorter hold, whatever motion the surface has.
const MAX_STATIC_HOLD = RHYTHM.maxStaticHold ?? 8;
// "It appears too soon and just stands still there." Two rules, because those
// are two different faults. A placement anchored to a phrase may lead it by no
// more than MAX_LEAD — a card that arrives two seconds early is on screen
// saying nothing. And once it is up, something has to keep landing on the
// words: the first reveal within MAX_FIRST_REVEAL, and no gap between reveals
// (or after the last one) longer than MAX_REVEAL_GAP.
const MAX_LEAD = RHYTHM.maxLead ?? 0.6;
const MAX_FIRST_REVEAL = RHYTHM.maxFirstReveal ?? 2.0;
// 6.5s, and the number is a judgement rather than a measurement: run it at 5s
// and it fires on stretches where the speaker genuinely spends six seconds on
// one idea, which is not a fault. Past about six and a half a static graphic
// starts reading as forgotten. The card is never actually motionless — the
// ground drifts and the content rises for its whole life — so this rule is
// about INFORMATION arriving, not movement.
const MAX_REVEAL_GAP = RHYTHM.maxRevealGap ?? 6.5;
// A plan that reaches for the same handful of presentations is the "every card
// is a box with text" failure wearing a different hat. Beyond a handful of
// cards, expect the plan to have gone shopping in the library.
// Scaled to the edit: a nine-card video needs fewer distinct looks than a
// twenty-card one, but neither should lean on three.
const minDistinct = (n) => RHYTHM.minDistinctLayouts ?? Math.min(12, Math.max(5, Math.ceil(n * 0.55)));
// Ideas the video NAMES but has no footage of are what `plate` scenes and
// bin/image-search.mjs exist for; a long edit with none is worth a nudge.
const SOURCED_HINT_AFTER = RHYTHM.sourcedHintAfter ?? 240;

// Stepped corner polygon at any notch size — the §0 primitive generalised.
const step = (n) => {
  const h = n / 2;
  const P = (x, y) => `${x} ${y}`;
  const pts = [
    P(0, `${n}px`), P(`${h}px`, `${n}px`), P(`${h}px`, `${h}px`), P(`${n}px`, `${h}px`), P(`${n}px`, 0),
    P(`calc(100% - ${n}px)`, 0), P(`calc(100% - ${n}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${h}px`), P(`calc(100% - ${h}px)`, `${n}px`), P("100%", `${n}px`),
    P("100%", `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${n}px)`), P(`calc(100% - ${h}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, `calc(100% - ${h}px)`), P(`calc(100% - ${n}px)`, "100%"),
    P(`${n}px`, "100%"), P(`${n}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${h}px)`), P(`${h}px`, `calc(100% - ${n}px)`), P(0, `calc(100% - ${n}px)`),
  ];
  return `polygon(${pts.join(",")})`;
};
const STEP_CARD = step(24); // md notch ×2 for video scale
const STEP_CHIP = step(16); // sm notch ×2

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── time anchors ──────────────────────────────────────────────────────────
// A time in the plan is a number of seconds, OR a spoken phrase, OR
// [phrase, offsetSeconds]. Phrases resolve against the clean transcript at
// build time: "start"-type fields take the first word's start, "end"-type
// fields the last word's end. Anchoring to words instead of seconds means the
// plan survives a re-cut of the A-roll, or a re-supplied source, unchanged.
const WORDS = JSON.parse(await readFile(plan.transcript ?? "work/transcript.clean.json", "utf8"));
const normTok = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const TOKS = WORDS.map((w) => normTok(w.text));
function findPhrase(phrase, near) {
  const want = phrase.split(/\s+/).map(normTok).filter(Boolean);
  const hits = [];
  outer: for (let i = 0; i <= TOKS.length - want.length; i++) {
    for (let k = 0; k < want.length; k++) if (TOKS[i + k] !== want[k]) continue outer;
    hits.push(i);
  }
  if (!hits.length) return null;
  if (hits.length > 1 && near === undefined) warn.push(`phrase "${phrase}" occurs ${hits.length}× — using the first; add a numeric hint to disambiguate`);
  const i = near === undefined ? hits[0] : hits.reduce((best, h) => (Math.abs(WORDS[h].start - near) < Math.abs(WORDS[best].start - near) ? h : best), hits[0]);
  return { start: WORDS[i].start, end: WORDS[i + want.length - 1].end };
}
// Every time in the composition sits on the frame grid. Snapping at resolve
// time (not just when printing) keeps `at + dur === next.at` exact, so a
// trimmed shot cannot leave a sub-frame overlap for the runtime to trip on.
const snap = (t) => Math.round(t * FPS) / FPS;

// spec: seconds | "phrase" | [phrase, offset] | [phrase, offset, "start"|"end"]
// The third element overrides which edge of the phrase is meant. `at`-style
// fields default to the phrase's start, `until`-style fields to its end — but
// "stop just before this phrase begins" needs the override.
// `maxLead` is passed only where an item's START is being resolved: a negative
// offset there means "appear before the words", which past a beat or so reads as
// a graphic that got ahead of the script. `until`-style specs are left alone —
// stopping just before a phrase begins is a normal thing to ask for.
function T(spec, mode, near, label, maxLead) {
  if (spec === undefined || spec === null) return undefined;
  if (typeof spec === "number") return snap(spec);
  const [phrase, offset = 0, edge] = Array.isArray(spec) ? spec : [spec, 0];
  const hit = findPhrase(phrase, near);
  if (!hit) { warn.push(`${label}: phrase not found in transcript: "${phrase}"`); return near ?? 0; }
  let off = offset;
  if (maxLead !== undefined && off < -maxLead) {
    warn.push(`LEAD: ${label} was set to arrive ${(-off).toFixed(1)}s before "${phrase}" — held to ${maxLead}s. A graphic that lands early has nothing to do until the words catch up.`);
    off = -maxLead;
  }
  return snap(((edge ?? mode) === "end" ? hit.end : hit.start) + off);
}

// ── resolve beats ─────────────────────────────────────────────────────────
// Every beat becomes zero or more timed items: broll entries and one card.
const brolls = [], cards = [];
let themeFlip = 0;
for (const b of plan.beats) {
  const hint = typeof b.start === "number" ? b.start : (typeof b.hint === "number" ? b.hint : undefined);
  b.start = T(b.start, "start", hint, b.id);
  b.end = T(b.end, "end", hint, b.id);
  const kind = b.visual ?? "aroll";
  if (kind.includes("broll") && b.broll?.length) {
    let cursor = T(b.broll[0].at, "start", b.start, b.id) ?? b.start;
    b.broll.forEach((e, n) => {
      const clip = clipById.get(e.clip);
      if (!clip) { warn.push(`${b.id}: unknown clip "${e.clip}"`); return; }
      const at = T(e.at, "start", b.start, b.id, MAX_LEAD) ?? cursor;
      const until = T(e.until, "end", b.start, b.id);
      const dur = snap(e.dur ?? (until !== undefined ? until - at : Math.max(0.5, (b.end - at))));
      if (e.in + dur > clip.duration + 0.05) warn.push(`${b.id}: window ${e.in}+${dur} exceeds ${clip.id} (${clip.duration}s) — clamped`);
      brolls.push({
        beat: b.id, n, clip, in: e.in, at, dur: Math.min(dur, clip.duration - e.in),
        fit: e.fit ?? "cover", treatment: e.treatment ?? "full", side: e.side ?? (defaultSide() === "left" ? "right" : "left"),
      });
      cursor = at + dur;
    });
  }
  if (kind.includes("card") && b.card) {
    const c = b.card;
    const at = T(c.at, "start", b.start, b.id, MAX_LEAD) ?? b.start;
    const until = T(c.until, "end", b.start, b.id);
    const dur = snap(c.dur ?? (until !== undefined ? until - at : (b.end - at)));
    // Reveal times may be phrases too: an item lands on the word that motivates it.
    // A phrase spoken before the card's own start (the face guard and overlap
    // resolution both push `at` later) resolves negative, which would fire the
    // reveal before the arming set that hides the item — and the item would then
    // never come back. Clamp into the card's life and say so, because the plan
    // wanted that item on that word and now it cannot have it.
    const REVEAL_MIN = 0.12;
    const reveal = c.reveal?.map((r, k) => {
      const raw = typeof r === "number" ? r : +(T(r, "start", at, `${b.id} reveal`) - at).toFixed(3);
      if (raw >= REVEAL_MIN) return Math.min(raw, dur - 0.25);
      warn.push(`REVEAL: ${b.id} item ${k + 1} is anchored ${(-raw).toFixed(1)}s before the card appears — held to the card's start instead. Move the card earlier or anchor the item to a later word.`);
      return REVEAL_MIN;
    });
    const theme = c.theme ?? (c.type === "endcard" ? "night" : (themeFlip++ % 2 ? "night" : "day"));
    let layout = c.layout ?? DEFAULT_LAYOUT[c.type] ?? "panel";
    if (VERT) {
      const sub = VERT_LAYOUT[`${c.type}:${layout}`];
      if (sub && sub !== layout) { swapped.push(`${b.id} ${c.type}:${layout} -> :${sub}`); layout = sub; }
    }
    if (reveal?.length) {
      const first = Math.min(...reveal), last = Math.max(...reveal);
      if (first > MAX_FIRST_REVEAL)
        warn.push(`CADENCE: ${b.id} shows nothing for its first ${first.toFixed(1)}s — move the first reveal within ${MAX_FIRST_REVEAL}s of the card, or start the card later.`);
      const sorted = [...reveal].sort((x, y) => x - y);
      for (let k = 1; k < sorted.length; k++)
        if (sorted[k] - sorted[k - 1] > MAX_REVEAL_GAP)
          warn.push(`CADENCE: ${b.id} holds still for ${(sorted[k] - sorted[k - 1]).toFixed(1)}s between reveals ${k} and ${k + 1} — anchor something to a word in between, or split the card.`);
      if (dur - last > MAX_REVEAL_GAP)
        warn.push(`CADENCE: ${b.id} sits finished for its last ${(dur - last).toFixed(1)}s — end it sooner with "until", or give it a final reveal.`);
    }
    cards.push({ beat: b.id, theme, side: c.side ?? defaultSide(), ...c, layout, at, dur, reveal });
  }
}
brolls.sort((a, b) => a.at - b.at);
cards.sort((a, b) => a.at - b.at);

// One thing owns a track. When phrase anchors land two items on top of each
// other, the later one wins and the earlier one ends where it starts — the
// later item is the one the speaker just gave a reason for. Anything left
// shorter than half a second is dropped rather than flashed.
function resolveOverlaps(items, label, sameLane = () => true) {
  const out = [];
  for (const it of items) {
    const prev = [...out].reverse().find((p) => sameLane(p, it));
    if (prev && it.at < prev.at + prev.dur - 0.01) {
      const newDur = snap(it.at - prev.at);
      if (newDur < 0.5) { out.splice(out.indexOf(prev), 1); warn.push(`${label}: ${prev.beat} dropped — ${it.beat} starts ${(prev.at + prev.dur - it.at).toFixed(2)}s before it ends`); }
      else { warn.push(`${label}: ${prev.beat} trimmed ${(prev.dur - newDur).toFixed(2)}s to make room for ${it.beat}`); prev.dur = newDur; }
    }
    out.push(it);
  }
  return out;
}
const brollsResolved = resolveOverlaps(brolls, "B-roll");
brolls.length = 0; brolls.push(...brollsResolved);

// Enforce the minimum hold. A shot grows forward into the gap before the next
// shot (and, failing that, backwards into the gap behind) up to the material
// the source clip actually has. What still cannot reach the floor is dropped.
for (let i = 0; i < brolls.length; i++) {
  const e = brolls[i];
  const floor = HOLD[e.treatment] ?? HOLD.full;
  if (e.dur >= floor - 1e-6) continue;
  const nextAt = brolls[i + 1]?.at ?? Infinity;
  const prevEnd = i > 0 ? brolls[i - 1].at + brolls[i - 1].dur : 0;
  const sourceLeft = e.clip.duration - e.in;
  const grown = snap(Math.min(floor, nextAt - e.at, sourceLeft));
  if (grown >= floor - 1e-6) {
    warn.push(`${e.beat}: held ${e.clip.id} ${(grown - e.dur).toFixed(1)}s longer — ${e.dur.toFixed(1)}s is below the ${floor}s floor`);
    e.dur = grown;
    continue;
  }
  // No room ahead: try starting earlier, so long as the previous shot allows.
  const earlier = snap(Math.max(prevEnd, e.at - (floor - grown)));
  const backIn = snap(e.in - (e.at - earlier));
  if (backIn >= 0 && snap(Math.min(nextAt, e.at + grown) - earlier) >= floor - 1e-6) {
    warn.push(`${e.beat}: pulled ${e.clip.id} ${(e.at - earlier).toFixed(1)}s earlier to reach the ${floor}s floor`);
    e.in = backIn; e.at = earlier; e.dur = snap(Math.min(nextAt, earlier + floor) - earlier);
    continue;
  }
  warn.push(`${e.beat}: DROPPED ${e.clip.id} — only ${grown.toFixed(1)}s of room, below the ${floor}s floor (a flashed cutaway is worse than none)`);
  e.drop = true;
}
{
  const kept = brolls.filter((e) => !e.drop);
  brolls.length = 0; brolls.push(...kept);
}
const cardsResolved = resolveOverlaps(cards, "card", (a, b) => a.side === b.side || a.type === "endcard" || b.type === "endcard");
cards.length = 0; cards.push(...cardsResolved);

// ── sourced imagery: the licence gate ─────────────────────────────────────
// A `plate` puts someone else's picture in the video. MEDIA-SOURCING.md says
// those are never placed automatically: proposed with a source URL, approved by
// a human, then frozen. So the builder REFUSES a plate whose file is not marked
// approved in media/sources.json, and builds its credit line from that record
// rather than from anything typed into the plan.
const SRC_FILE = flag("--sources", "media/sources.json");
const SOURCES = existsSync(SRC_FILE) ? JSON.parse(await readFile(SRC_FILE, "utf8")) : { images: [] };
const byFile = new Map((SOURCES.images ?? []).map((s) => [s.file, s]));
const sceneClips = [];
const shortSource = (rec) => {
  try { if (rec.page) return new URL(rec.page).hostname.replace(/^www\./, ""); } catch {}
  return (rec.provider ?? "").split("/").pop() || "source";
};
for (const c of cards.filter((x) => x.type === "plate")) {
  // A scene holds one to four pictures; `file` is the single-image shorthand.
  // A scene slot holds either a sourced still (`file`, gated on approval) or a
  // clip out of our own B-roll library (`clip` + `in`), which needs no gate
  // because the footage is ours. Mixing the two in one scene is fine.
  const wanted = c.media ?? c.images ?? (c.file ? [{ file: c.file }] : []);
  if (!wanted.length) { warn.push(`${c.beat}: plate has no media`); c.drop = true; continue; }
  const resolved = [];
  for (const [k, w] of wanted.entries()) {
    if (w.clip) {
      const clip = clipById.get(w.clip);
      if (!clip) { warn.push(`${c.beat}: unknown clip "${w.clip}" in scene`); c.drop = true; break; }
      const inAt = w.in ?? 0;
      // A scene clip plays for as long as the scene is on screen. A shorter cut
      // ends mid-card and the runtime hides it, leaving an empty white mount —
      // so the card's own life is the duration, not whatever the plan guessed.
      const want = c.dur ?? 5;
      const avail = clip.duration - inAt;
      const dur = Math.min(want, avail);
      if (dur < 1.5) { warn.push(`${c.beat}: scene clip ${clip.id} only has ${dur.toFixed(1)}s at ${inAt}s — pick another window`); c.drop = true; break; }
      if (avail < want - 0.05) {
        warn.push(`SCENE: ${c.beat} holds ${want.toFixed(1)}s but ${clip.id} only has ${avail.toFixed(1)}s left after ${inAt}s — the frame would go blank; use an earlier "in", a longer clip, or shorten the card`);
      }
      const file = `broll/scene-${clip.id}-${inAt}-${dur.toFixed(1)}.mp4`.replace(/\.0-/g, "-");
      sceneClips.push({ clip, in: inAt, dur, file });
      resolved.push({ kind: "video", src: file, id: `scene-${cards.indexOf(c)}-${k}`, slot: k, dur,
        sourceShort: w.sourceShort ?? null, credit: `${clip.file} · own footage` });
      continue;
    }
    const rec = byFile.get(w.file);
    if (!rec) { warn.push(`${c.beat}: REFUSED plate image "${w.file}" — no entry in media/sources.json (run bin/image-search.mjs, then approve it)`); c.drop = true; break; }
    if (!rec.approved) { warn.push(`${c.beat}: REFUSED plate image "${w.file}" — found but not approved. Open media/review.html, then set "approved": true`); c.drop = true; break; }
    // The composition is self-contained: the picture is copied in beside the
    // footage, not linked out of the project. Without this the renderer drops
    // it silently and the scene renders as an empty frame.
    let src = rec.src ?? `media/${rec.file}`;
    if (!rec.src) {
      const from = join("media", rec.file);
      const to = join(OUT, "media", rec.file);
      await mkdir(dirname(to), { recursive: true });
      await place(from, to);
    }
    // A slot fixed at 16/9 crops a portrait photograph until the subject is
    // gone — a tall product shot came back as a screen and one row of keys.
    // Measure the file and let the mount take the picture's own shape, clamped
    // so nothing extreme reflows the scene.
    let ar = null;
    try {
      const d = await probeSize(join("media", rec.file));
      if (d.w > 0 && d.h > 0) ar = Math.min(2.2, Math.max(0.62, d.w / d.h));
    } catch { /* unreadable: fall back to the layout's default */ }
    // A slide may name the word it arrives on. Resolved against the card's own
    // start so it survives a re-cut like every other placement.
    let slideAt = null;
    if (w.at !== undefined) {
      const abs = T(w.at, "start", c.at, `${c.beat} slide ${k + 1}`);
      if (abs !== undefined) slideAt = Math.max(0.1, Math.min(c.dur - 0.3, +(abs - c.at).toFixed(3)));
    }
    resolved.push({
      kind: "image",
      id: `plate-${cards.indexOf(c)}-${k}`,
      src, ar, slideAt,
      // Both credits come from the record, so neither can drift from the licence:
      // the chip on the picture is short, the full line is kept for the description.
      sourceShort: w.sourceShort ?? rec.sourceShort ?? shortSource(rec),
      credit: rec.credit ?? [rec.title, rec.creator && `by ${rec.creator}`, rec.license, rec.provider].filter(Boolean).join(" · "),
    });
  }
  if (c.drop) continue;
  c.images = resolved;
  c.media = resolved;
  c.src = resolved[0].src;                        // the single-image layouts
  c.source = resolved.map((r) => r.credit).join("   ·   ");
  // The manifest's caption is a convenience for the framed layouts. A full-bleed
  // picture is meant to carry NOTHING but the picture and its credit, so it does
  // not inherit one — set `caption` in the plan if a particular shot needs words.
  if (c.layout !== "full" && !c.caption && byFile.get(wanted[0].file)?.caption)
    c.caption = byFile.get(wanted[0].file).caption;
}
{
  const kept = cards.filter((c) => !c.drop);
  cards.length = 0; cards.push(...kept);
}

// ── the face guard ────────────────────────────────────────────────────────
// A panel that lands on the speaker's face is the one mistake no amount of
// good typography survives. Panels have a known footprint, so check it against
// the measured face box and move the card rather than let it cover him: the
// other side first, then the low band, then the high one. Say so if nothing
// clears — better a warning than a silently ruined shot.
const FACE_PAD = 24;
// The EYE LINE is the hard limit, not the chin. A graphic across the jaw is an
// ordinary lower-third; one across the eyes kills the shot. So the guard
// protects the upper 60% of the measured face box, which leaves the band under
// the chin usable — which is where a wide panel has to live.
// plan.face is measured on the A-roll file. Landscape shows that file frame-for-
// frame, so the numbers pass through; portrait shows a centre crop of it inside
// the band, so the box must be mapped through the same object-fit: cover
// transform the browser applies — otherwise the guard defends bare ground.
const FACE_FRAME = (() => {
  // The A-roll occupies a rect — the whole frame, or the band — and fills it with
  // object-fit: cover. Map the measured box through the same transform the
  // browser applies, or the guard defends a part of the frame he is not in.
  // In landscape the rect and the file share an aspect, so this is the identity.
  const box = BAND ? { y: BAND.y, h: BAND.h } : { y: 0, h: H };
  const s = Math.max(W / AROLL_SIZE.w, box.h / AROLL_SIZE.h);
  const dx = (W - AROLL_SIZE.w * s) / 2, dy = (box.h - AROLL_SIZE.h * s) / 2;
  const m = (x, y) => [Math.round(x * s + dx), Math.round(y * s + dy + box.y)];
  const [x0, y0] = m(FACE.x0, FACE.y0), [x1, y1] = m(FACE.x1, FACE.y1);
  return { x0, y0, x1, y1 };
})();
// Portrait full-bleed: he owns the middle of the frame, so a panel belongs in
// the band under his chin and the caption in the strip above his head. Neither
// can then cross his face at all, which is the point — the guard below becomes
// a backstop rather than the thing doing the work.
if (VERT && !BANDED) ZONE = { top: Math.max(TOP_SAFE, FACE_FRAME.y1 + 24), bot: H - BOT_SAFE };
// A text panel sits below his chin. A PICTURE gets the taller band that starts
// just under the eye line: a photograph needs the height to be worth showing,
// and a graphic across the jaw is an ordinary lower third. Without this the
// image card grew upward over his face the moment the picture got bigger.
const ZONE_PIC = VERT && !BANDED
  ? { top: Math.round(FACE_FRAME.y0 + (FACE_FRAME.y1 - FACE_FRAME.y0) * 0.6) + 56, bot: H - BOT_SAFE }
  : null;
const zoneFor = (c) => (ZONE_PIC && c.type === "plate" ? ZONE_PIC : ZONE);
const EYE = { x0: FACE_FRAME.x0, x1: FACE_FRAME.x1, y0: FACE_FRAME.y0, y1: FACE_FRAME.y0 + (FACE_FRAME.y1 - FACE_FRAME.y0) * 0.6 };
function panelRect(c) {
  const w = c.width ?? (WIDE_LAYOUT.has(`${c.type}:${c.layout}`) ? 1180 : PANEL_W);
  const wide = w > W * 0.55;
  const v = c.v ?? (wide ? "bottom" : "mid");
  // Height is not known until the browser lays it out; assume a generous panel
  // so the guard errs toward moving rather than toward covering.
  const h = c.type === "lower-third" ? 260
    : wide ? 360                                    // a rail reads across, not down
    : Math.min(560, 200 + (c.items?.length ?? c.steps?.length ?? 2) * 90);
  const x = c.x !== undefined ? c.x : (wide || c.centre) ? Math.round((W - w) / 2) : panelX(c.side);
  const Z = zoneFor(c);
  const y = v === "top" ? Z.top : v === "bottom" ? Z.bot - h : midY(h, Z);
  return { x, y, w, h, wide };
}
const hits = (r) => r.x < EYE.x1 + FACE_PAD && r.x + r.w > EYE.x0 - FACE_PAD
                 && r.y < EYE.y1 + FACE_PAD && r.y + r.h > EYE.y0 - FACE_PAD;
for (const c of cards) {
  if (isFull(c) || OVERLAY.has(c.type) || c.type === "lower-third") continue;
  if (c.ignoreFace) continue;
  if (!hits(panelRect(c))) continue;
  const tries = [
    { side: c.side === "left" ? "right" : "left" },
    { v: "bottom" }, { v: "top" },
    { side: c.side === "left" ? "right" : "left", v: "bottom" },
    { side: c.side === "left" ? "right" : "left", v: "top" },
  ];
  const before = `${c.side}/${c.v ?? "mid"}`;
  const fix = tries.find((t) => !hits(panelRect({ ...c, ...t })));
  if (fix) {
    Object.assign(c, fix);
    warn.push(`FACE: ${c.beat} ${c.type}:${c.layout} moved ${before} -> ${c.side}/${c.v ?? "mid"} — it covered the face`);
  } else {
    warn.push(`FACE: ${c.beat} ${c.type}:${c.layout} covers the face and nowhere clears it — narrow it, or set "ignoreFace": true if the shot allows`);
  }
}

// When the A-roll arrived with cutaways already baked in (work/baked-segments.json
// from the background-deviation scan), anything not covered by our own
// full-frame B-roll or the endcard will show through — say so.
if (existsSync("work/baked-segments.json")) {
  // `keep: true` marks baked footage we are happy to leave in (relevant B-roll
  // we do not have ourselves); only the rest must be covered.
  const baked = JSON.parse(await readFile("work/baked-segments.json", "utf8")).segments.filter((s) => !s.keep);
  const covers = [...brolls.filter((e) => e.treatment === "full").map((e) => [e.at, e.at + e.dur]), ...cards.filter((c) => isFull(c)).map((c) => [c.at, c.at + c.dur])];
  for (const s of baked) {
    let t = s.start, gaps = [];
    const inside = covers.filter(([a, b]) => b > s.start && a < s.end).sort((x, y) => x[0] - y[0]);
    for (const [a, b] of inside) { if (a > t + 0.3) gaps.push([t, a]); t = Math.max(t, b); }
    if (s.end > t + 0.3) gaps.push([t, s.end]);
    if (gaps.length) warn.push(`baked-in cutaway ${s.start}-${s.end}s shows through at ${gaps.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(", ")}`);
  }
}

// ── B-roll trims ──────────────────────────────────────────────────────────
// Each used window is cut from the 4K source once, at composition size, with
// a 0.4s handle either side for the crossfade. Cached by clip+in+dur, so a
// changed window re-cuts and an unchanged one costs nothing.
const HANDLE = 0.4;
let cut = 0, cached = 0;
for (const e of brolls) {
  e.cw = W; e.ch = H;
  const name = `${e.clip.id}-${e.in.toFixed(2)}-${e.dur.toFixed(2)}-${e.fit}-${e.cw}x${e.ch}.mp4`.replace(/\.00/g, "");
  e.file = `broll/${name}`;
  const dst = join(OUT, e.file);
  if (existsSync(dst) && !has("--force")) { cached++; continue; }
  const ss = Math.max(0, e.in - HANDLE);
  e.handle = e.in - ss;
  // Three ways to put a shot in a frame it does not match:
  //   cover   (default) fill the frame, crop the overflow. A 9:16 crop of a
  //           16:9 shot keeps 31.6% of its width, which is right for a detail
  //           and wrong for anything where the whole object matters.
  //   whole   fit the WIDTH and fill above and below with a blurred, darkened
  //           copy of the same frame. Nothing of the shot is lost. This is what
  //           a product macro or a wide needs in a vertical frame.
  //   pillar  the transpose — fit the height, fill the sides. For a portrait
  //           source in a landscape frame.
  // The backdrop is a ZOOMED centre of the same frame, not a straight crop of
  // it. A crop inherits the source's own composition, so a macro shot over a
  // dark tray put a black void above the picture and a readable close-up below.
  // Blown up 1.4x the frame height and blurred to nothing, it becomes a wash of
  // the colours immediately behind the subject — which is what a fill should be.
  const blurFill = (fitDim) =>
    `split[a][b];[a]scale=-2:${Math.round(e.ch * 1.4)}:force_original_aspect_ratio=increase,crop=${e.cw}:${e.ch},` +
    `gblur=sigma=64,eq=brightness=-0.26:saturation=0.62[bg];[b]${fitDim}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${FPS},format=yuv420p`;
  const fit = e.fit === "pillar" ? blurFill(`scale=-2:${e.ch}`)
    : e.fit === "whole" ? blurFill(`scale=${e.cw}:-2`)
    : `scale=${e.cw}:${e.ch}:force_original_aspect_ratio=increase,crop=${e.cw}:${e.ch},fps=${FPS},format=yuv420p`;
  const argv = ["-y", "-v", "error", ...HW, "-ss", ss.toFixed(3), "-i", e.clip.path, "-t", (e.dur + 2 * HANDLE).toFixed(3),
    "-filter_complex", fit, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-g", String(FPS), "-keyint_min", String(FPS), "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst];
  process.stdout.write(`  cutting ${e.beat} <- ${e.clip.id} @${e.in}s ${e.dur.toFixed(1)}s ... `);
  const t0 = Date.now();
  try { await run("ffmpeg", argv, { maxBuffer: 16 * 1024 * 1024 }); }
  catch (err) { // the device was listed but cannot decode this one: software
    await run("ffmpeg", argv.filter((a, i) => !(a === "-hwaccel" || argv[i - 1] === "-hwaccel")), { maxBuffer: 16 * 1024 * 1024 });
  }
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
  cut++;
}
for (const e of brolls) e.handle = e.handle ?? Math.min(HANDLE, e.in);

// Scene clips are cut smaller than a full-frame cutaway — they sit inside a
// framed slot, never full-bleed, so 1280x720 is more than the slot can show.
for (const sc of sceneClips) {
  const dst = join(OUT, sc.file);
  if (existsSync(dst) && !has("--force")) { cached++; continue; }
  const ss = Math.max(0, sc.in - HANDLE);
  sc.handle = sc.in - ss;
  const argv = ["-y", "-v", "error", ...HW, "-ss", ss.toFixed(3), "-i", sc.clip.path,
    "-t", (sc.dur + 2 * HANDLE).toFixed(3),
    "-vf", `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=${FPS},format=yuv420p`,
    "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-g", String(FPS), "-keyint_min", String(FPS),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst];
  process.stdout.write(`  scene clip ${sc.clip.id} @${sc.in}s ${sc.dur.toFixed(1)}s ... `);
  const t0 = Date.now();
  try { await run("ffmpeg", argv, { maxBuffer: 16 * 1024 * 1024 }); }
  catch { await run("ffmpeg", argv.filter((a, i) => !(a === "-hwaccel" || argv[i - 1] === "-hwaccel")), { maxBuffer: 16 * 1024 * 1024 }); }
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
  cut++;
}
for (const sc of sceneClips) sc.handle = sc.handle ?? Math.min(HANDLE, sc.in);
// the resolved media entries need the handle the cut actually used
for (const c of cards.filter((x) => x.type === "plate")) {
  for (const m of c.media ?? []) {
    if (m.kind !== "video") continue;
    const sc = sceneClips.find((x) => x.file === m.src);
    if (sc) m.handle = sc.handle;
  }
}

// ── card renderers ────────────────────────────────────────────────────────
// Every card is: a positioned .pxcard with a stepped face, an optional
// eyebrow (Tiny5 — the one sanctioned label slot), then type-specific rows.
// Elements that should animate carry .el; the compiler staggers them.
const eyebrow = (t) => (t ? `<div class="eyebrow el">${esc(t)}</div>` : "");
const wordmark = (theme, w = 180) => `<img class="wordmark el" src="brand/${theme === "night" ? "nowa-wordmark-pastel.svg" : "nowa-wordmark.svg"}" style="width:${w}px" alt="Nowa" />`;

// ── the layout library ────────────────────────────────────────────────────
// A card has two axes, on purpose:
//   type   = WHAT the data is  (a list, a figure, a comparison, a statement)
//   layout = HOW it is presented
// The same three bullet points can be numbered rows, a grid of tiles, a stack
// of huge lines or a cluster of chips. Pick per card; `node bin/layouts.mjs`
// renders the whole library to a contact sheet so you can choose by eye.
//
// Adding a layout is a function here plus its CSS in the sheet below. It does
// not need a new type, and the variety warning counts TYPE:LAYOUT pairs, so a
// second `list` in a different layout does not read as a repeat.
const li = (it) => (typeof it === "string" ? { text: it } : it);

const renderers = {
  "lower-third": {
    // the standing brand bar
    bar: (c) => `
    ${c.wordmark ? wordmark(c.theme, 170) : ""}
    ${eyebrow(c.eyebrow)}
    <div class="title el">${esc(c.title)}</div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // name on a coral rule, nothing else — for a returning series
    rule: (c) => `
    ${c.wordmark ? wordmark(c.theme, 150) : ""}
    <div class="lt-rule"></div>
    <div class="title el">${esc(c.title)}</div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
  },

  bignum: {
    // figure over label, in a corner panel
    panel: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="numrow el">${num(c)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ""}</div>
    ${c.label ? `<div class="label el">${esc(c.label)}</div>` : ""}
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // the figure IS the frame
    hero: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="numrow numrow--hero el">${num(c)}${c.unit ? `<span class="unit xl">${esc(c.unit)}</span>` : ""}</div>
    ${c.label ? `<div class="label xl el">${esc(c.label)}</div>` : ""}
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // figure left of a hard seam, words right
    split: (c) => `
    <div class="bn-split">
      <div class="bn-l">${num(c)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ""}</div>
      <div class="bn-seam"></div>
      <div class="bn-r">
        ${eyebrow(c.eyebrow)}
        ${c.label ? `<div class="label el">${esc(c.label)}</div>` : ""}
        ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}
      </div>
    </div>`,
    // numeral above an oversized label — a poster, not a stat
    stack: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="bn-stack">
      <div class="numrow el">${num(c)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ""}</div>
      ${c.label ? `<div class="bn-stack-label el">${esc(c.label)}</div>` : ""}
    </div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // value over total, on a rule — a proportion you can read at a glance
    fraction: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="bn-frac el">
      <span class="bn-frac-n">${esc(c.value)}</span>
      <span class="bn-frac-bar"></span>
      <span class="bn-frac-d">${esc(c.of ?? c.unit ?? "")}</span>
    </div>
    ${c.label ? `<div class="label el">${esc(c.label)}</div>` : ""}
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // a figure with the proportion drawn under it
    meter: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="numrow el">${num(c)}${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ""}</div>
    <div class="meter el"><span class="meter-fill" data-pct="${c.pct ?? 100}"></span></div>
    ${c.label ? `<div class="label el">${esc(c.label)}</div>` : ""}
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
  },

  list: {
    // the same rows at panel scale — for when the speaker should stay on screen
    panel: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="title small el">${esc(c.title)}</div>` : ""}
    <div class="lp">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="lp-row el" data-i="${i}">${c.numbered === false ? `<span class="lp-tick"></span>` : `<span class="lp-n">${String(i + 1).padStart(2, "0")}</span>`}<span class="lp-t">${esc(it.text)}</span></div>`; }).join("")}
    </div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // numbered rows with a rule between — the workhorse
    rows: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="list-title el">${esc(c.title)}</div>` : ""}
    <div class="li-wrap${c.numbered === false ? " bare" : ""}">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="li el" data-i="${i}">${c.numbered === false ? "" : `<span class="li-n">${String(i + 1).padStart(2, "0")}</span>`}<span class="li-t">${esc(it.text)}</span>${it.note ? `<span class="li-note">${esc(it.note)}</span>` : ""}</div>`; }).join("")}
    </div>`,
    // tiles: each item a stepped card, 2 or 3 across
    grid: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="list-title el">${esc(c.title)}</div>` : ""}
    <div class="lg" style="grid-template-columns:repeat(${c.cols ?? Math.min(3, c.items.length)},1fr)">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="lg-cell el" data-i="${i}"><div class="lg-face"></div><div class="lg-body">${c.numbered === false ? "" : `<span class="lg-n">${String(i + 1).padStart(2, "0")}</span>`}<span class="lg-t">${esc(it.text)}</span>${it.note ? `<span class="lg-note">${esc(it.note)}</span>` : ""}</div></div>`; }).join("")}
    </div>`,
    // no numerals, no rules: each item a line of very large type
    stack: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="ls">
      ${c.items.map((x, i) => `<div class="ls-mask el" data-i="${i}"><div class="ls-line">${esc(li(x).text)}</div></div>`).join("")}
    </div>
    ${c.title ? `<div class="sub el">${esc(c.title)}</div>` : ""}`,
    // a wrapping cluster of pills — for short tags rather than sentences
    chips: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="list-title el">${esc(c.title)}</div>` : ""}
    <div class="lc">
      ${c.items.map((x, i) => `<span class="lc-chip el" data-i="${i}">${esc(li(x).text)}</span>`).join("")}
    </div>`,
    // an oversized numeral beside each line — an index, not a list
    index: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="lx">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="lx-row el" data-i="${i}"><span class="lx-n">${String(i + 1).padStart(2, "0")}</span><span class="lx-b"><span class="lx-t">${esc(it.text)}</span>${it.note ? `<span class="lx-note">${esc(it.note)}</span>` : ""}</span></div>`; }).join("")}
    </div>`,
    // a staircase — each item steps further in, joined by a rule
    steps: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="lst">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="lst-row el" data-i="${i}" style="margin-left:${i * 110}px"><span class="lst-tick"></span><span class="lst-t">${esc(it.text)}</span>${it.note ? `<span class="lst-note">${esc(it.note)}</span>` : ""}</div>`; }).join("")}
    </div>`,
    // side by side across the frame, hairlines between
    columns: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="list-title el">${esc(c.title)}</div>` : ""}
    <div class="lco" style="grid-template-columns:repeat(${c.items.length},1fr)">
      ${c.items.map((x, i) => { const it = li(x); return `<div class="lco-col el" data-i="${i}">${c.numbered === false ? "" : `<span class="lco-n">${String(i + 1).padStart(2, "0")}</span>`}<span class="lco-t">${esc(it.text)}</span>${it.note ? `<span class="lco-note">${esc(it.note)}</span>` : ""}</div>`; }).join("")}
    </div>`,
  },

  checklist: {
    rows: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="title small el">${esc(c.title)}</div>` : ""}
    <ul class="checks">
      ${c.items.map((x, i) => `<li class="check el" data-i="${i}"><span class="box">${TICK}</span><span>${esc(li(x).text)}</span></li>`).join("")}
    </ul>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    grid: (c) => `
    ${eyebrow(c.eyebrow)}
    ${c.title ? `<div class="title small el">${esc(c.title)}</div>` : ""}
    <ul class="checks checks--grid" style="grid-template-columns:repeat(${c.cols ?? 2},1fr)">
      ${c.items.map((x, i) => `<li class="check el" data-i="${i}"><span class="box">${TICK}</span><span>${esc(li(x).text)}</span></li>`).join("")}
    </ul>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
  },

  process: {
    chips: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="steps el">
      ${c.steps.map((s, i) => `<div class="stepchip${i === c.active ? " on" : ""}${i < c.active ? " done" : ""}" data-i="${i}">${esc(s)}</div>${i < c.steps.length - 1 ? `<div class="march"></div>` : ""}`).join("")}
    </div>
    ${c.labels ? `<div class="steplabels el">${c.labels.map((l, i) => `<div class="steplabel${i === c.active ? " on" : ""}" data-i="${i}">${esc(l)}</div>`).join("")}</div>` : ""}
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // the same phases stacked down the frame with a rail
    rail: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="prail">
      ${c.steps.map((s, i) => `<div class="prail-row${i === c.active ? " on" : ""}${i < c.active ? " done" : ""}" data-i="${i}"><span class="prail-dot"></span><span class="prail-t">${esc(s)}</span>${c.labels?.[i] ? `<span class="prail-note">${esc(c.labels[i])}</span>` : ""}</div>`).join("")}
    </div>`,
  },

  callout: {
    // a rotated sticker slapped on the frame
    sticker: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="callout el">${esc(c.text)}</div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    panel: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="callout el">${esc(c.text)}</div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // a coral bar down the left edge instead of a full surface
    bar: (c) => `
    <div class="co-bar"></div>
    <div class="co-body">
      ${eyebrow(c.eyebrow)}
      <div class="callout el">${esc(c.text)}</div>
      ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}
    </div>`,
  },

  timeline: {
    rows: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="tl">
      ${c.items.map((it, i) => `<div class="tlrow el${i === c.active ? " on" : ""}${i < (c.active ?? -1) ? " done" : ""}" data-i="${i}"><span class="tldot"></span><span class="tlwhen">${esc(it.when)}</span><span class="tlwhat">${esc(it.what)}</span></div>`).join("")}
    </div>
    ${c.sub ? `<div class="sub el">${esc(c.sub)}</div>` : ""}`,
    // left to right along a rail — reads as a road, not a list
    track: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="ttrack">
      <div class="ttrack-rail"></div>
      ${c.items.map((it, i) => `<div class="ttrack-stop el${i === c.active ? " on" : ""}${i < (c.active ?? -1) ? " done" : ""}" data-i="${i}"><span class="ttrack-dot"></span><span class="ttrack-when">${esc(it.when)}</span><span class="ttrack-what">${esc(it.what)}</span></div>`).join("")}
    </div>`,
  },

  statement: {
    // each line its own block, offset — reads like something stamped
    blocks: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="stmt stmt--blocks">
      ${lines(c.text).map((l, i) => `<div class="stb el" data-i="${i}" style="margin-left:${i * 64}px"><span>${esc(l)}</span></div>`).join("")}
    </div>
    ${c.sub ? `<div class="stmt-sub el">${esc(c.sub)}</div>` : ""}`,
    // lines rising out from behind masks
    masked: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="stmt">
      ${lines(c.text).map((l) => `<div class="stmt-mask"><div class="stmt-line">${esc(l)}</div></div>`).join("")}
    </div>
    ${c.sub ? `<div class="stmt-sub el">${esc(c.sub)}</div>` : ""}`,
    // centred, quieter, for a beat that should feel like a breath
    center: (c) => `
    <div class="stmt stmt--center">
      ${eyebrow(c.eyebrow)}
      ${lines(c.text).map((l) => `<div class="stmt-mask"><div class="stmt-line">${esc(l)}</div></div>`).join("")}
      ${c.sub ? `<div class="stmt-sub el">${esc(c.sub)}</div>` : ""}
    </div>`,
    // type at poster scale, bleeding toward the edges
    oversize: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="stmt stmt--over">
      ${lines(c.text).map((l) => `<div class="stmt-mask"><div class="stmt-line">${esc(l)}</div></div>`).join("")}
    </div>
    ${c.sub ? `<div class="stmt-sub el">${esc(c.sub)}</div>` : ""}`,
  },

  quote: {
    // the sentence inside a stepped card, sitting on the footage
    card: (c) => `
    <div class="qcard el">
      <div class="qcard-face"></div>
      <div class="qcard-body">
        <div class="quote-rule"></div>
        <div class="quote">${words(c.text)}</div>
        ${c.attrib ? `<div class="quote-attrib">${esc(c.attrib)}</div>` : ""}
      </div>
    </div>`,
    rail: (c) => `
    <div class="quote-rule"></div>
    <div class="quote">${words(c.text)}</div>
    ${c.attrib ? `<div class="quote-attrib el">${esc(c.attrib)}</div>` : ""}`,
    center: (c) => `
    <div class="quote quote--center">
      <div class="quote-mark">&ldquo;</div>
      <div>${words(c.text)}</div>
      ${c.attrib ? `<div class="quote-attrib el">${esc(c.attrib)}</div>` : ""}
    </div>`,
  },

  compare: {
    // two columns either side of a hard seam
    columns: (c) => `
    <div class="cmp">
      ${[c.left, c.right].map((col, i) => `
        <div class="cmp-col${(c.win ?? 1) === i ? " win" : ""}" data-i="${i}">
          <div class="cmp-h el">${esc(col.head)}</div>
          ${col.big ? `<div class="cmp-big el">${esc(col.big)}</div>` : ""}
          <div class="cmp-items">${(col.items ?? []).map((t) => `<div class="cmp-i el">${esc(t)}</div>`).join("")}</div>
        </div>`).join(`<div class="cmp-seam"></div>`)}
    </div>`,
    // stacked bands — better when the lines are long
    stack: (c) => `
    <div class="cmp cmp--stack">
      ${[c.left, c.right].map((col, i) => `
        <div class="cmp-col${(c.win ?? 1) === i ? " win" : ""}" data-i="${i}">
          <div class="cmp-h el">${esc(col.head)}</div>
          ${col.big ? `<div class="cmp-big el">${esc(col.big)}</div>` : ""}
          <div class="cmp-items">${(col.items ?? []).map((t) => `<div class="cmp-i el">${esc(t)}</div>`).join("")}</div>
        </div>`).join(`<div class="cmp-seam cmp-seam--h"></div>`)}
    </div>`,
    // two labelled bars — proportion rather than prose
    bars: (c) => `
    <div class="cbars">
      ${[c.left, c.right].map((col, i) => `
        <div class="cbar-row${(c.win ?? 1) === i ? " win" : ""}" data-i="${i}">
          <div class="cbar-h el">${esc(col.head)}</div>
          <div class="cbar-track el"><span class="cbar-fill" style="width:${col.pct ?? (i === (c.win ?? 1) ? 92 : 34)}%"></span></div>
          <div class="cbar-b el">${esc(col.big ?? "")}${(col.items ?? []).length ? ` <span class="cbar-note">${esc(col.items[0])}</span>` : ""}</div>
        </div>`).join("")}
    </div>`,
    // two plates with a coral pivot between them
    versus: (c) => `
    <div class="cmp cmp--vs">
      ${[c.left, c.right].map((col, i) => `
        <div class="vs-plate${(c.win ?? 1) === i ? " win" : ""}" data-i="${i}">
          <div class="vs-face"></div>
          <div class="vs-body">
            <div class="cmp-h el">${esc(col.head)}</div>
            ${col.big ? `<div class="cmp-big el">${esc(col.big)}</div>` : ""}
            <div class="cmp-items">${(col.items ?? []).map((t) => `<div class="cmp-i el">${esc(t)}</div>`).join("")}</div>
          </div>
        </div>`).join(`<div class="vs-pivot el">vs</div>`)}
    </div>`,
  },

  // ── sourced imagery ─────────────────────────────────────────────────────
  // A real picture of a real thing, in a Nowa frame, with its credit. The
  // builder refuses to place one that is not approved in media/sources.json.
  plate: {
    // ── image scenes ──────────────────────────────────────────────────
    // A full-frame brand surface: the copy stacked in ink/coral blocks on the
    // left, the pictures framed on the right, each with its own source chip.
    // One to four images; the layout says how they are arranged.
    hero: (c) => sceneHTML(c, 1),
    duo: (c) => sceneHTML(c, 2),
    trio: (c) => sceneHTML(c, 3),
    quad: (c) => sceneHTML(c, 4),
    // one picture, given the frame, with the copy tucked into the corner
    wide: (c) => `
    <div class="pscene pscene--wide">
      <div class="pfig pfig--wide">${figIMG((c.media ?? c.images)[0])}${srcChip((c.media ?? c.images)[0])}</div>
      <div class="pcopy pcopy--corner">
        ${eyebrow(c.eyebrow)}
        ${blocks(c.title)}
        ${c.caption ? `<div class="pcap el">${esc(c.caption)}</div>` : ""}
      </div>
    </div>`,
    // a tilted print with the caption on the mount, like a pinned photo
    polaroid: (c) => `
    <div class="polaroid el">
      <img src="${esc(c.src)}" alt="" style="max-height:${c.maxHeight ?? 520}px" />
      <div class="polaroid-strip">
        ${c.caption ? `<div class="plate-cap">${esc(c.caption)}</div>` : ""}
        <div class="credit">${esc(c.source)}</div>
      </div>
    </div>`,
    // centred in the brand surface, credit under the frame
    frame: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="plate el"><img src="${esc(c.src)}" alt="" style="max-height:${c.maxHeight ?? 620}px" /></div>
    ${c.caption ? `<div class="plate-cap el">${esc(c.caption)}</div>` : ""}
    <div class="credit el">${esc(c.source)}</div>`,
    // image bleeds to the frame, credit sits bottom-left over it
    full: (c) => `
    <img class="plate-bleed" src="${esc(c.src)}" alt="" />
    ${c.caption ? `<div class="plate-cap plate-cap--over el">${esc(c.caption)}</div>` : ""}
    <div class="bleed-src">Source: ${esc(c.images?.[0]?.sourceShort ?? c.source)}</div>`,
    // a framed picture beside the speaker, panel-sized
    // ── a slideshow ──────────────────────────────────────────────────
    // Several pictures in one frame, each arriving on the word that calls for
    // it. For a stretch of script that is hard to picture, one still is a
    // caption and three are an explanation. Each slide carries its OWN source
    // chip, because they rarely come from the same place, and the chip fades
    // with the picture it belongs to.
    slides: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="pslides" style="aspect-ratio: var(--slide-ar, 4/3)">
      ${(c.media ?? []).map((x, i) => `<div class="pslide${i === 0 ? " on" : ""}" data-i="${i}"${figAR(x)}>${figIMG(x)}${srcChip(x)}</div>`).join("")}
    </div>
    ${c.caption ? `<div class="plate-cap el">${esc(c.caption)}</div>` : ""}`,
    inset: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="plate el"><img src="${esc(c.src)}" alt="" style="max-height:${c.maxHeight ?? 380}px" /></div>
    ${c.caption ? `<div class="plate-cap el">${esc(c.caption)}</div>` : ""}
    <div class="credit el">${esc(c.source)}</div>`,
  },

  endcard: {
    // wordmark one side, the ask on the other
    split: (c) => `
    <div class="end-split">
      <div class="end-l">${wordmark("night", 460)}</div>
      <div class="end-seam"></div>
      <div class="end-r">
        ${c.title ? `<div class="endtitle el">${esc(c.title)}</div>` : ""}
        ${c.sub ? `<div class="endsub el">${esc(c.sub)}</div>` : ""}
        ${c.cta ? `<div class="cta el"><span>${esc(c.cta)}</span></div>` : ""}
      </div>
    </div>`,
    center: (c) => `
    ${wordmark("night", 560)}
    ${c.title ? `<div class="endtitle el">${esc(c.title)}</div>` : ""}
    ${c.sub ? `<div class="endsub el">${esc(c.sub)}</div>` : ""}
    ${c.cta ? `<div class="cta el"><span>${esc(c.cta)}</span></div>` : ""}`,
  },

  annotate: {
    // everything dims except the thing being pointed at
    spotlight: (c) => {
      const [x, y, w, h] = c.box ?? [W / 2 - 260, H / 2 - 200, 520, 400];
      return `
    <svg class="anno anno--spot" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><mask id="spot-${c.beat}"><rect width="${W}" height="${H}" fill="#fff"/>
        <ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#000"/></mask></defs>
      <rect class="spot-scrim" width="${W}" height="${H}" fill="rgba(22,28,36,.76)" mask="url(#spot-${c.beat})"/>
      <ellipse class="mk" cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" pathLength="100" fill="none"/>
    </svg>
    ${c.label ? `<div class="anno-label el" style="left:${x}px;top:${y + h + 24}px">${esc(c.label)}</div>` : ""}`;
    },
    mark: (c) => {
      const [x, y, w, h] = c.box ?? [W / 2 - 200, H / 2 - 150, 400, 300];
      const shape = c.shape ?? "circle";
      const paths = {
        circle: `<ellipse class="mk" cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" pathLength="100" />`,
        underline: `<path class="mk" d="M${x} ${y + h} L${x + w} ${y + h}" pathLength="100" />`,
        arrow: `<path class="mk" d="M${x} ${y} L${x + w} ${y + h}" pathLength="100" /><path class="mk-head" d="M${x + w - 34} ${y + h - 8} L${x + w} ${y + h} L${x + w - 8} ${y + h - 34}" pathLength="100" />`,
        bracket: `<path class="mk" d="M${x + 60} ${y} L${x} ${y} L${x} ${y + h} L${x + 60} ${y + h}" pathLength="100" /><path class="mk" d="M${x + w - 60} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x + w - 60} ${y + h}" pathLength="100" />`,
      };
      return `
    <svg class="anno" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none">${paths[shape] ?? paths.circle}</svg>
    ${c.label ? `<div class="anno-label el" style="left:${x}px;top:${y + h + 24}px">${esc(c.label)}</div>` : ""}`;
    },
  },

  cells: {
    // one bar of cells — a proportion rather than a count
    bar: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="cellrow cellrow--bar">
      ${Array.from({ length: c.count }, (_, i) => `<span class="cell${i < c.filled ? " lit" : ""}" data-i="${i}"></span>`).join("")}
    </div>
    ${c.label ? `<div class="cell-label el">${esc(c.label)}</div>` : ""}`,
    row: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="cellrow">
      ${Array.from({ length: c.count }, (_, i) => `<span class="cell${i < c.filled ? " lit" : ""}" data-i="${i}"></span>`).join("")}
    </div>
    ${c.label ? `<div class="cell-label el">${esc(c.label)}</div>` : ""}`,
    grid: (c) => `
    ${eyebrow(c.eyebrow)}
    <div class="cellrow cellrow--grid" style="grid-template-columns:repeat(${c.cols ?? Math.ceil(Math.sqrt(c.count))},1fr)">
      ${Array.from({ length: c.count }, (_, i) => `<span class="cell${i < c.filled ? " lit" : ""}" data-i="${i}"></span>`).join("")}
    </div>
    ${c.label ? `<div class="cell-label el">${esc(c.label)}</div>` : ""}`,
  },
};


// Copy set as stacked blocks — ink, then coral, alternating. Split on " / ".
const blocks = (t) => t ? `<div class="pblocks">${lines(t).map((l, i) => `<div class="pblk el" data-i="${i}"><span>${esc(l)}</span></div>`).join("")}</div>` : "";
// A slot holds a still or a clip. The clip is a framework-timed media element
// with its own id, so the runtime discovers it and drives playback; without an
// id the renderer freezes it on frame one.
const figIMG = (im) => im.kind === "video"
  ? `<span class="pmount"><video class="clip" id="${esc(im.id)}" src="${esc(im.src)}" muted playsinline
      data-start="${im.at}" data-duration="${im.dur}" data-media-start="${(im.handle ?? 0).toFixed(3)}" data-track-index="${6 + (im.slot ?? 0)}"></video></span>`
  : `<span class="pmount"><img${im.id ? ` id="${esc(im.id)}"` : ""} src="${esc(im.src)}" alt="" /></span>`;
// Set on the .pfig so the CSS aspect-ratio rules can defer to it.
const figAR = (im) => (im?.ar ? ` style="--fig-ar:${im.ar.toFixed(4)}"` : "");
// The credit rides on the picture it belongs to, not in a footnote.
const srcChip = (im) => im.sourceShort ? `<span class="srcchip">Source: ${esc(im.sourceShort)}</span>` : "";
// n images: 1 beside the copy, 2 with a secondary overlapping, 3 in a column,
// 4 as one large plus a row of three. The copy block is the same every time.
const sceneHTML = (c, n) => {
  const im = (c.media ?? c.images).slice(0, n);
  const fig = (x, cls = "") => `<div class="pfig ${cls} el"${figAR(x)}>${figIMG(x)}${srcChip(x)}</div>`;
  const art =
    n === 1 ? fig(im[0], "pfig--main")
    : n === 2 ? `<div class="pstack2">${fig(im[0], "pfig--main")}${im[1] ? fig(im[1], "pfig--sec") : ""}</div>`
    : n === 3 ? `<div class="pstack3">${fig(im[0], "pfig--main")}<div class="pcol">${im.slice(1).map((x) => fig(x, "pfig--small")).join("")}</div></div>`
    : `<div class="pstack4">${fig(im[0], "pfig--main")}<div class="prow">${im.slice(1).map((x) => fig(x, "pfig--small")).join("")}</div></div>`;
  return `
    <div class="pscene pscene--${n}">
      <div class="pcopy">
        ${eyebrow(c.eyebrow)}
        ${blocks(c.title)}
        ${c.caption ? `<div class="pcap el">${esc(c.caption)}</div>` : ""}
      </div>
      <div class="part">${art}</div>
    </div>`;
};

const TICK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M4 12l5 5L20 6"/></svg>`;
const lines = (t) => String(t).split(" / ");
const words = (t) => String(t).split(/\s+/).map((w) => `<span class="qw">${esc(w)}</span>`).join(" ");
const num = (c) => {
  const numeric = typeof c.value === "number" || /^[\d,.]+$/.test(String(c.value));
  const counts = numeric && c.count !== false;
  return `<span class="num${counts ? " count" : ""}" data-to="${esc(c.value)}" data-fmt="${c.fmt ?? ",d"}">${counts ? "0" : esc(c.value)}</span>`;
};



function cardHost(c, i) {
  // A scene clip plays for the card's life (or its own, if shorter). Times are
  // settled here because the card's at/dur can still move during overlap
  // resolution and the face guard.
  for (const m of c.media ?? []) {
    if (m.kind !== "video") continue;
    const dur = Math.min(m.dur, c.dur);
    const [st, dr] = startDur(c.at, dur);
    m.at = st; m.dur = dr;
  }
  const byLayout = renderers[c.type];
  if (!byLayout) throw new Error(`${c.beat}: unknown card type "${c.type}" — have ${Object.keys(renderers).join(", ")}`);
  const r = byLayout[c.layout];
  if (!r) throw new Error(`${c.beat}: type "${c.type}" has no layout "${c.layout}" — have ${Object.keys(byLayout).join(", ")}`);
  const id = `card-${i}`;
  const cls = ["pxcard", `pxcard--${c.theme}`, `pxcard--${c.type}`, `lay--${c.type}-${c.layout}`];
  if (isFull(c) && c.over === "footage") cls.push("pxcard--over");
  let style = "";
  if (isFull(c) || OVERLAY.has(c.type)) style = `left:0;top:0;width:${W}px;height:${H}px;`;
  else if (c.type === "lower-third") style = `left:${GUTTER}px;bottom:${BOT_SAFE}px;max-width:${Math.min(c.maxWidth ?? 900, W - 2 * GUTTER)}px;`;
  else if (c.type === "plate") {
    // Landscape centres a picture insert in the frame. Portrait cannot: centred
    // it lands on his eyes the moment the picture is big enough to be worth
    // showing. It goes in the picture band instead, bottom-aligned by default.
    const w = VERT ? PANEL_W : (c.width ?? PANEL_W + 120);
    if (!VERT) style = `left:${panelX(c.side)}px;top:50%;transform:translateY(-50%);width:${w}px;`;
    else {
      const Z = zoneFor(c);
      const v = c.v ?? "bottom";
      const y = v === "top" ? `top:${Z.top}px`
        : v === "bottom" ? `bottom:${H - Z.bot}px`
        : `top:${Math.round((Z.top + Z.bot) / 2)}px;transform:translateY(-50%)`;
      style = `left:${GUTTER}px;${y};width:${w}px;`;
    }
  }
  else {
    // Panels: a side and a vertical berth, so consecutive cards do not all
    // land in the same rectangle. `v` is top | mid | bottom.
    // A panel wider than one third of the frame cannot sit in a corner, so it
    // centres horizontally and takes the band under the face instead.
    const w = c.width ?? (WIDE_LAYOUT.has(`${c.type}:${c.layout}`) ? 1180 : PANEL_W);
    const wide = w > W * 0.55;
    const v = c.v ?? (wide ? "bottom" : "mid");
    const Z = zoneFor(c);
    const y = v === "top" ? `top:${Z.top}px`
      : v === "bottom" ? `bottom:${H - Z.bot}px`
      : VERT ? `top:${Math.round((Z.top + Z.bot) / 2)}px;transform:translateY(-50%)`
      : `top:50%;transform:translateY(-50%)`;
    const x = c.x !== undefined ? `left:${c.x}px` : wide || c.centre ? `left:${Math.round((W - w) / 2)}px` : `left:${panelX(c.side)}px`;
    style = `${x};${y};width:${w}px;`;
  }
  // The timed host is the framework's (it owns visibility); every tween lands
  // on the inner wrapper, which also takes the hard kill at the end so a seek
  // that jumps past the fade never finds a half-faded card.
  return {
    id,
    html: `      <div class="card-host clip" id="${id}" data-start="${startDur(c.at, c.dur)[0]}" data-duration="${startDur(c.at, c.dur)[1]}" data-track-index="5">
        <div class="card-inner" id="${id}-inner">
          <div class="${cls.join(" ")}" style="${style}">
            <div class="face"></div>${isFull(c) && c.over !== "footage" ? `
            <div class="cdrift"></div>` : ""}
            <div class="body">${r(c)}
            </div>
          </div>
        </div>
      </div>`,
  };
}

// ── GSAP compiler ─────────────────────────────────────────────────────────
const tl = [];
// How a card arrives. Panels rise by default; full-frame types take the frame
// with a wipe or a chunky stepped dither (the sanctioned "future signature" in
// MOTION.md), which is what stops a run of cards reading as one device.
const ENTER = {
  rise: (sel, at, d) => [`  tl.fromTo('${sel}', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: ${d}, ease: 'expo.out' }, ${q(at)});`],
  fade: (sel, at, d) => [`  tl.fromTo('${sel}', { opacity: 0 }, { opacity: 1, duration: ${d}, ease: 'power2.out' }, ${q(at)});`],
  wipe: (sel, at, d) => [
    `  tl.set('${sel}', { opacity: 1, clipPath: 'inset(0 100% 0 0)' }, ${q(at)});`,
    `  tl.to('${sel}', { clipPath: 'inset(0 0% 0 0)', duration: ${d}, ease: 'expo.out' }, ${q(at)});`,
  ],
  dither: (sel, at, d) => [
    `  tl.set('${sel}', { opacity: 1, clipPath: 'inset(0 100% 0 0)' }, ${q(at)});`,
    `  tl.to('${sel}', { clipPath: 'inset(0 0% 0 0)', duration: ${d}, ease: 'steps(9)' }, ${q(at)});`,
  ],
  // Rise from the bottom edge — for a lower-third that should feel planted.
  plant: (sel, at, d) => [`  tl.fromTo('${sel}', { opacity: 0, y: 90 }, { opacity: 1, y: 0, duration: ${d}, ease: 'expo.out' }, ${q(at)});`],
};
const EXIT = {
  rise: (sel, at, d) => [`  tl.to('${sel}', { opacity: 0, y: -12, duration: ${d}, ease: 'power2.in' }, ${q(at)});`],
  fade: (sel, at, d) => [`  tl.to('${sel}', { opacity: 0, duration: ${d}, ease: 'power2.in' }, ${q(at)});`],
  wipe: (sel, at, d) => [`  tl.to('${sel}', { clipPath: 'inset(0 0 0 100%)', duration: ${d}, ease: 'expo.in' }, ${q(at)});`],
  dither: (sel, at, d) => [`  tl.to('${sel}', { clipPath: 'inset(0 0 0 100%)', duration: ${d}, ease: 'steps(7)' }, ${q(at)});`],
  plant: (sel, at, d) => [`  tl.to('${sel}', { opacity: 0, y: 40, duration: ${d}, ease: 'power2.in' }, ${q(at)});`],
};
const defaultEnter = (c) =>
  c.type === "endcard" ? "fade"
  : c.type === "statement" || c.type === "quote" ? "dither"
  : isFull(c) ? "wipe"
  : c.type === "lower-third" ? "plant"
  : OVERLAY.has(c.type) ? "fade"
  : "rise";

const cardHosts = cards.map((c, i) => {
  const h = cardHost(c, i);
  const sel = `#${h.id}-inner`;
  const life = c.dur;
  const IN = 0.7, OUT = 0.5; // exits run ~75% of the entrance (MOTION.md)
  const mode = c.enter ?? defaultEnter(c);
  tl.push(...(ENTER[mode] ?? ENTER.rise)(sel, c.at, IN));
  // .el children stagger in behind the surface. On a long hold the stagger is
  // spread across a third of the life instead of finishing in 300ms, so the
  // card keeps arriving while he is still talking about it.
  const stag = c.stagger ?? Math.min(0.45, Math.max(0.07, life * 0.055));
  const hasEl = h.html.split('class="').slice(1).some((a) => a.split('"')[0].split(" ").includes("el"));

  const owned = revealOwns(c);
  const elSel = owned ? `${sel} .el:not(${owned})` : `${sel} .el`;
  if (hasEl) tl.push(`  tl.fromTo('${elSel}', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out', stagger: ${stag.toFixed(3)} }, ${q(c.at + 0.12)});`);

  // ── the card never stops moving ───────────────────────────────────────
  // One linear tween each, no repeat: a seek to any frame lands on the right
  // position, which a CSS loop could not promise.
  if (isFull(c) && c.over !== "footage") {
    const d = Math.round(Math.min(140, Math.max(45, life * 9)));
    tl.push(`  tl.fromTo('${sel} .cdrift', { x: 0, y: 0 }, { x: ${-d}, y: ${-Math.round(d * 0.6)}, duration: ${life.toFixed(3)}, ease: 'none' }, ${q(c.at)});`);
  }
  // A still in a scene would otherwise be a photograph of a photograph. Video
  // slots move on their own and are left alone.
  if (c.type === "plate" && c.layout === "slides") {
    // One-shot linear cross-fades, never a loop: a seek to any frame has to land
    // on exactly one visible slide. Slide 0 is up from the start; each later one
    // fades in on its word and takes the frame from the one before it.
    const slides = (c.media ?? []).map((m, i) => ({ i, at: m.slideAt ?? (i === 0 ? 0 : (c.dur * i) / c.media.length) }))
      .sort((a, b) => a.at - b.at);
    const FADE = 0.42;
    slides.forEach((sl, n) => {
      const tgt = `${sel} .pslide[data-i="${sl.i}"]`;
      if (n === 0) { tl.push(`  tl.set('${tgt}', { opacity: 1 }, ${q(c.at)});`); return; }
      tl.push(`  tl.set('${tgt}', { opacity: 0 }, ${q(c.at)});`);
      tl.push(`  tl.to('${tgt}', { opacity: 1, duration: ${FADE}, ease: 'power2.out' }, ${q(c.at + sl.at)});`);
      const prev = `${sel} .pslide[data-i="${slides[n - 1].i}"]`;
      tl.push(`  tl.to('${prev}', { opacity: 0, duration: ${FADE}, ease: 'power2.in' }, ${q(c.at + sl.at)});`);
    });
    c.slideCount = slides.length;
  }
  if (c.type === "plate") {
    const stills = (c.media ?? []).filter((m) => m.kind !== "video");
    if (stills.length) {
      tl.push(`  tl.fromTo('${sel} .pmount img', { scale: 1 }, { scale: ${(1 + Math.min(0.09, life * 0.007)).toFixed(3)}, duration: ${life.toFixed(3)}, ease: 'none' }, ${q(c.at)});`);
    }
  }
  // Long full-frame holds get a slow content rise on top of the ground drift.
  if (isFull(c) && life > 6 && c.type !== "endcard") {
    tl.push(`  tl.fromTo('${sel} .body', { y: 10 }, { y: -10, duration: ${life.toFixed(3)}, ease: 'none' }, ${q(c.at)});`);
  }
  if (c.type === "bignum") {
    tl.push(`  (function(){ var el = document.querySelector('${sel} .num.count'); if (!el) return; var o = { v: 0 }; var to = parseFloat(el.dataset.to.replace(/,/g, '')); tl.to(o, { v: to, duration: 0.9, ease: 'power2.out', onUpdate: function(){ el.textContent = window.__fmt(o.v, el.dataset.fmt); } }, ${q(c.at + 0.25)}); })();`);
  }
  if (c.type === "bignum" && c.layout === "meter") {
    tl.push(`  tl.fromTo('${sel} .meter-fill', { width: '0%' }, { width: '${c.pct ?? 100}%', duration: 0.9, ease: 'expo.out' }, ${q(c.at + 0.25)});`);
  }
  if (c.type === "process") {
    // Marching pixels: one linear background-position tween across the card's life.
    if (c.layout === "chips") tl.push(`  tl.to('${sel} .march', { backgroundPosition: '-${Math.round(life * 40)}px 0', duration: ${life.toFixed(3)}, ease: 'none' }, ${q(c.at)});`);
    // Steps light up as the speaker names them: the named step takes the
    // coral, the one before it settles to "done". Sets, not tweens, so a
    // seek lands on the right state.
    if (c.reveal?.length) {
      const night = c.theme === "night";
      const ON = { bg: "#ef493d", fg: "#ffffff" };
      const DONE = night ? { bg: "#3f7a23", fg: "#ffffff" } : { bg: "#e7f6df", fg: "#3f7a23" };
      const LABEL_ON = night ? "#ffffff" : "#161c24", LABEL_OFF = night ? "#c4cdd5" : "#454f5b";
      const chip = c.layout === "rail" ? ".prail-dot" : ".stepchip";
      const lab = c.layout === "rail" ? ".prail-t" : ".steplabel";
      c.reveal.forEach((t, k) => {
        const T = q(c.at + t);
        tl.push(`  tl.set('${sel} ${chip}[data-i="${k}"], ${sel} .prail-row[data-i="${k}"] .prail-dot', { backgroundColor: '${ON.bg}', color: '${ON.fg}' }, ${T});`);
        tl.push(`  tl.set('${sel} ${lab}[data-i="${k}"], ${sel} .prail-row[data-i="${k}"] .prail-t', { color: '${LABEL_ON}', fontWeight: 600 }, ${T});`);
        if (k > 0) {
          tl.push(`  tl.set('${sel} ${chip}[data-i="${k - 1}"], ${sel} .prail-row[data-i="${k - 1}"] .prail-dot', { backgroundColor: '${DONE.bg}', color: '${DONE.fg}' }, ${T});`);
          tl.push(`  tl.set('${sel} ${lab}[data-i="${k - 1}"], ${sel} .prail-row[data-i="${k - 1}"] .prail-t', { color: '${LABEL_OFF}', fontWeight: 400 }, ${T});`);
        }
      });
    }
  }
  if (c.type === "timeline" && c.reveal?.length) {
    // Milestones light as he reaches them: the named one takes the coral, the
    // one before it settles to done. Same grammar as process, a different rail.
    const night = c.theme === "night";
    const ON = "#ef493d", DONE = "#3f7a23", DOT_OFF = night ? "#212b36" : "#dfe3e8";
    const LABEL_OFF = night ? "#c4cdd5" : "#454f5b";
    const stop = c.layout === "track" ? ".ttrack-stop" : ".tlrow";
    const dot = c.layout === "track" ? ".ttrack-dot" : ".tldot";
    const when = c.layout === "track" ? ".ttrack-when" : ".tlwhen";
    tl.push(`  tl.set('${sel} ${dot}', { backgroundColor: '${DOT_OFF}' }, ${q(c.at)});`);
    c.reveal.forEach((t, k) => {
      const T = q(c.at + t);
      tl.push(`  tl.set('${sel} ${stop}[data-i="${k}"] ${dot}', { backgroundColor: '${ON}' }, ${T});`);
      tl.push(`  tl.set('${sel} ${stop}[data-i="${k}"] ${when}', { color: '${ON}' }, ${T});`);
      tl.push(`  tl.fromTo('${sel} ${stop}[data-i="${k}"] ${dot}', { scale: 0.4 }, { scale: 1, duration: 0.34, ease: 'expo.out' }, ${T});`);
      if (k > 0) {
        tl.push(`  tl.set('${sel} ${stop}[data-i="${k - 1}"] ${dot}', { backgroundColor: '${DONE}' }, ${T});`);
        tl.push(`  tl.set('${sel} ${stop}[data-i="${k - 1}"] ${when}', { color: '${LABEL_OFF}' }, ${T});`);
      }
    });
  }
  if (c.type === "checklist" && c.reveal?.length) {
    // Items land on the words that motivate them — override the generic stagger.
    tl.push(`  tl.set('${sel} .check', { opacity: 0, y: 24 }, ${q(c.at)});`);
    c.reveal.forEach((t, k) => tl.push(`  tl.to('${sel} .check[data-i="${k}"]', { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, ${q(c.at + t)});`));
  }
  if (c.type === "statement") {
    const line = c.layout === "blocks" ? ".stb" : ".stmt-line";
    if (c.reveal?.length) {
      // Each line lands on the words that motivate it, so a long hold keeps
      // arriving instead of sitting finished.
      if (c.layout === "blocks") {
        tl.push(`  tl.set('${sel} .stb', { opacity: 0, y: 26 }, ${q(c.at)});`);
        c.reveal.forEach((t, k) => tl.push(`  tl.to('${sel} .stb[data-i="${k}"]', { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, ${q(c.at + t)});`));
      } else {
        tl.push(`  tl.set('${sel} .stmt-line', { y: '110%' }, ${q(c.at)});`);
        c.reveal.forEach((t, k) => tl.push(`  tl.to('${sel} .stmt-mask:nth-child(${k + 1}) .stmt-line', { y: '0%', duration: 0.9, ease: 'expo.out' }, ${q(c.at + t)});`));
      }
    } else if (c.layout !== "blocks") {
      tl.push(`  tl.set('${sel} .stmt-line', { y: '110%' }, ${q(c.at)});`);
      tl.push(`  tl.to('${sel} .stmt-line', { y: '0%', duration: 0.9, ease: 'expo.out', stagger: ${Math.min(0.5, Math.max(0.09, life * 0.05)).toFixed(3)} }, ${q(c.at + 0.18)});`);
    }
    void line;
  }
  if (c.type === "compare" && c.reveal?.length) {
    // The two sides arrive one at a time — the contrast is the point, and it
    // reads better made than presented.
    const col = c.layout === "versus" ? ".vs-plate" : c.layout === "bars" ? ".cbar-row" : ".cmp-col";
    tl.push(`  tl.set('${sel} ${col}', { opacity: 0, y: 24 }, ${q(c.at)});`);
    c.reveal.forEach((t, k) => tl.push(`  tl.to('${sel} ${col}[data-i="${k}"]', { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }, ${q(c.at + t)});`));
    if (c.layout === "versus") tl.push(`  tl.fromTo('${sel} .vs-pivot', { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'steps(2)' }, ${q(c.at + (c.reveal[1] ?? 1))});`);
  }
  if (c.type === "quote") {
    // Word-stagger brighten: the sentence is already there, dim, and lights up
    // left to right as he says it (MOTION.md signature move).
    const span = Math.min(life * 0.55, 2.6);
    tl.push(`  tl.set('${sel} .qw', { opacity: 0.16 }, ${q(c.at)});`);
    tl.push(`  tl.to('${sel} .qw', { opacity: 1, duration: 0.3, ease: 'none', stagger: { each: ${(span / Math.max(1, String(c.text).split(/\s+/).length)).toFixed(3)} } }, ${q(c.at + 0.3)});`);
    if (c.layout === "rail") tl.push(`  tl.fromTo('${sel} .quote-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'expo.out' }, ${q(c.at + 0.1)});`);
  }
  if (c.type === "list" && c.reveal?.length) {
    // Each layout carries its own item element; the reveal lands on whichever
    // one this card is using, so timing-to-the-word survives a layout swap.
    const it = LIST_ITEM[c.layout] ?? ".li";
    const from = c.layout === "chips" || c.layout === "grid" ? "{ opacity: 0, y: 22 }" : "{ opacity: 0, x: -28 }";
    const to = c.layout === "chips" || c.layout === "grid" ? "{ opacity: 1, y: 0" : "{ opacity: 1, x: 0";
    tl.push(`  tl.set('${sel} ${it}', ${from}, ${q(c.at)});`);
    c.reveal.forEach((t, k) => tl.push(`  tl.to('${sel} ${it}[data-i="${k}"]', ${to}, duration: 0.5, ease: 'expo.out' }, ${q(c.at + t)});`));
  }
  if (c.type === "list" && c.layout === "stack" && !c.reveal?.length) {
    // Stacked lines rise from behind their masks, like a statement.
    tl.push(`  tl.set('${sel} .ls-line', { y: '110%' }, ${q(c.at)});`);
    tl.push(`  tl.to('${sel} .ls-line', { y: '0%', duration: 0.9, ease: 'expo.out', stagger: 0.09 }, ${q(c.at + 0.18)});`);
  }
  if (c.type === "annotate") {
    // The mark draws itself on, then the arrowhead pops after the shaft lands.
    tl.push(`  tl.fromTo('${sel} .mk', { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: ${c.draw ?? 0.55}, ease: 'power2.out' }, ${q(c.at)});`);
    if (c.shape === "arrow") tl.push(`  tl.fromTo('${sel} .mk-head', { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'none' }, ${q(c.at + (c.draw ?? 0.55) * 0.8)});`);
  }
  if (c.type === "cells") {
    // Cells light one at a time, chunky — the pet-world register, so steps().
    const step = Math.min(0.22, (life * 0.4) / Math.max(1, c.filled));
    tl.push(`  tl.set('${sel} .cell.lit', { opacity: 0.18 }, ${q(c.at)});`);
    for (let k = 0; k < c.filled; k++) {
      tl.push(`  tl.to('${sel} .cell.lit[data-i="${k}"]', { opacity: 1, duration: 0.12, ease: 'steps(2)' }, ${q(c.at + 0.3 + k * step)});`);
    }
  }
  if (c.type !== "endcard") {
    const xmode = c.exit ?? (mode === "dither" || mode === "wipe" ? mode : mode);
    tl.push(...(EXIT[xmode] ?? EXIT.rise)(sel, c.at + c.dur - OUT, OUT));
    tl.push(`  tl.set('${sel}', { opacity: 0 }, ${q(c.at + c.dur)});`);
  }
  return h.html;
});

// B-roll: crossfade over the A-roll beneath. Full cutaways fade the video
// itself; insets fade the framed wrapper so the shadow and frame go with it.
// A fade proportional to the hold: a fixed 0.3s on each end of a short shot
// leaves it barely up, while a long shot wants a slower blend. Capped so a
// cutaway never spends more than a quarter of its life in transition.
const fadeFor = (dur) => Math.min(0.45, Math.max(0.22, dur * 0.11));
const brollHosts = brolls.map((e, i) => {
  const FADE = fadeFor(e.dur);
  const id = `broll-${i}`;
  // An inset is a landscape idea: footage beside the speaker, not instead of him.
  // Portrait has no "beside", and the band exists only because the talking head
  // is 720p — the B-roll is 4K. Played in the band an inset left two thirds of
  // the frame as empty parchment, at the one moment footage should be filling it.
  // So in portrait every cutaway is full-bleed.
  const inset = e.treatment === "inset" && !VERT;
  const wrapStyle = inset
    ? `left:${panelX(e.side) - 60}px;top:50%;width:${PANEL_W + 120}px;height:${Math.round((PANEL_W + 120) * 9 / 16)}px;transform:translateY(-50%) rotate(${e.side === "left" ? -1.5 : 1.5}deg);`
    : `left:0;top:0;width:${W}px;height:${H}px;`;
  const target = inset ? `#${id}` : `#${id}-video`;
  // `enter: "wipe"` swaps the crossfade for a chunky stepped wipe — the brand's
  // pixel register. Use it where a hard change of subject is wanted; a montage
  // of related shots still reads better cross-faded.
  if (e.enter === "wipe") {
    const dir = e.from === "right" ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
    tl.push(`  tl.set('${target}', { opacity: 1, clipPath: '${dir}' }, ${q(e.at)});`);
    tl.push(`  tl.to('${target}', { clipPath: 'inset(0 0% 0 0)', duration: ${Math.max(0.3, FADE)}, ease: 'steps(8)' }, ${q(e.at)});`);
    tl.push(`  tl.to('${target}', { opacity: 0, duration: ${FADE}, ease: 'power2.in' }, ${q(e.at + e.dur - FADE)});`);
  } else {
    tl.push(`  tl.fromTo('${target}', { opacity: 0 }, { opacity: 1, duration: ${FADE}, ease: 'power2.out' }, ${q(e.at)});`);
    tl.push(`  tl.to('${target}', { opacity: 0, duration: ${FADE}, ease: 'power2.in' }, ${q(e.at + e.dur - FADE)});`);
  }
  tl.push(`  tl.set('${target}', { opacity: 0 }, ${q(e.at + e.dur)});`);
  return `      <div class="broll${inset ? " broll--inset" : ""}" id="${id}" style="${wrapStyle}${inset ? "opacity:0;" : ""}">
        <video class="clip" id="${id}-video" src="${e.file}" muted playsinline data-start="${startDur(e.at, e.dur)[0]}" data-duration="${startDur(e.at, e.dur)[1]}" data-media-start="${e.handle.toFixed(3)}" data-track-index="3" style="opacity:${inset ? 1 : 0};"></video>
      </div>`;
});

// ── the standing rail steps aside ─────────────────────────────────────────
// It is furniture for the parchment ground, so whenever something owns the whole
// frame — a full-frame card, a full-bleed cutaway — the rail should not be in the
// render tree at all. Behind an opaque video it is invisible either way, but the
// contrast check still measures it there and reads 1.38:1, and a check that
// cannot tell the difference is a check that will hide a real fault one day.
if (BANDED && (plan.rail || plan.standing)) {
  const merge = (rs) => {
    const out = [];
    for (const [a, b] of rs.sort((x, y) => x[0] - y[0])) {
      const last = out[out.length - 1];
      if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  };
  const cutaways = brolls.map((e) => [e.at, e.at + e.dur]);
  // The rail lives in the strip above the band, which only something owning the
  // whole frame can reach. The standing question lives IN the card zone, so it
  // yields to every card, not just the full-frame ones — otherwise it would peek
  // out from behind a panel and read as two graphics fighting.
  const gates = [
    [plan.rail && ".brand-rail", merge([...cutaways, ...cards.filter((c) => isFull(c)).map((c) => [c.at, c.at + c.dur])])],
    [plan.standing && ".standing", merge([...cutaways, ...cards.map((c) => [c.at, c.at + c.dur])])],
  ];
  for (const [sel, ranges] of gates) {
    if (!sel) continue;
    for (const [a, b] of ranges) {
      tl.push(`  tl.set('${sel}', { opacity: 0 }, ${q(Math.max(0, a))});`);
      tl.push(`  tl.set('${sel}', { opacity: 1 }, ${q(b)});`);
    }
  }
}

// ── captions ──────────────────────────────────────────────────────────────
const CAP = plan.captions ?? { enabled: true };
const CAP_ON = CAP.enabled !== false && !has("--no-captions");
let capSets = "";
if (CAP_ON) {
  const words = WORDS;
  const MAXW = CAP.maxWords ?? 4;
  // Full-frame cards own the frame; nothing else prints over them.
  const mute = [...(CAP.suppress ?? []), ...cards.filter((c) => isFull(c)).map((c) => [c.at - 0.2, c.at + c.dur + 0.2])];
  // A chunk that STARTS before a full-frame card and ends inside it would sit
  // on the card until its own clear fires. Test the whole chunk's span.
  const muted = (from, to) => mute.some(([a, b]) => to > a && from < b);
  // ONE coral per view: a visible card owns it, so the caption highlight
  // falls back to weight while any card is up.
  const cardUp = (t) => cards.some((c) => t >= c.at && t < c.at + c.dur);

  const chunks = []; let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const gap = next ? next.start - words[i].end : Infinity;
    if (cur.length >= MAXW || /[.,!?…:;]$/.test(words[i].text) || gap > 0.35) { chunks.push(cur); cur = []; }
  }
  if (cur.length) chunks.push(cur);

  const isKey = (raw) => {
    const w = raw.replace(/[.,!?…:;]$/, "");
    if (/\d/.test(w)) return true;
    if (/^(Nowa|Shenzhen|EVT|DVT|PVT|USB|Wi-?Fi|Bluetooth|iOS|Android|October|September)$/i.test(w)) return true;
    return w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  };
  const lines = [];
  for (const ch of chunks) {
    const at = ch[0].start;
    if (muted(at, ch[ch.length - 1].end)) continue;
    const cls = cardUp(at) ? "kw" : "k";
    let used = false;

    const html = ch.map((w) => (!used && isKey(w.text) ? ((used = true), `<b class="${cls}">${esc(w.text)}</b>`) : esc(w.text))).join(" ");
    lines.push(`  tl.set('#caption', { innerHTML: '${html.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' }, ${q(at)});`);
    lines.push(`  tl.set('#caption', { innerHTML: '' }, ${q(ch[ch.length - 1].end + 0.001)});`);
  }
  capSets = lines.join("\n");
}

// ── emit ──────────────────────────────────────────────────────────────────
// ── the vertical ruleset ──────────────────────────────────────────────────
// NOT the landscape sheet with smaller numbers. That was the first attempt and
// it is why the full-frame cards came back "weirdly empty and out of
// proportional": a layout composed for a 1920x1080 frame, re-typed at 0.65 and
// dropped into 1080x1920, leaves a block of content sitting in the middle third
// with a third of the frame empty above and below it.
//
// A vertical full-frame card is a POSTER. Three rules follow from that:
//   1. Display type is set against the frame HEIGHT, not scaled down from the
//      landscape size — a numeral that owns a 1920-tall frame is ~600px, not
//      300px.
//   2. Content spans the frame rather than clustering at its centre: the body
//      gets a tall padding box and distributes, so the eye travels.
//   3. Body copy, rows and labels go UP, not down. A vertical cut is watched on
//      a phone, usually muted, and the small type is what carries it.
//
// Panels are the opposite problem and stay compact — they sit in the band under
// his chin and must not grow into his face.
const PORTRAIT_CSS = !VERT ? "" : `
      /* ── full-frame cards: composed as posters ───────────────────────── */
      /* A full-frame card in portrait is a 1080x1920 canvas holding two or three
         lines. Centring a small left-aligned block in that leaves it adrift with
         a third of the frame empty above and below — which is what "weirdly
         empty and out of proportional" means. The type has to COMMAND the frame,
         so display sizes here are set from the frame's width: a line of a
         statement is sized to span it, and wrapping to four lines is the
         intended result rather than something to avoid.
         The top padding reserves the strip the caption owns, or the card's
         eyebrow lands on the caption chip's line and the two collide. */
      .pxcard--statement .body, .pxcard--list .body, .pxcard--compare .body,
      .pxcard--quote .body, .lay--bignum-hero .body, .lay--bignum-split .body {
        padding: ${CAP_TOP_Y + 150}px ${GUTTER + 16}px ${Math.round(H * 0.09)}px !important;
        justify-content: center !important; height: ${H}px; gap: 44px;
      }
      /* ~968px of usable width; at 150px an Onest line of 12-13 characters spans
         it, so a statement fills three or four lines instead of floating in two. */
      .stmt-line { font-size: 150px; line-height: 1.01; letter-spacing: -.05em; }
      .stmt--center .stmt-line { font-size: 128px; }
      .stmt--over .stmt-line { font-size: 168px; letter-spacing: -.055em; }
      .stmt { gap: 10px; }
      .stmt-sub { font-size: 44px; }
      /* statement:blocks sizes its own span, so it missed the line size above
         and stayed a small box in a big field. Its stepped indent also has to
         shrink — 64px per line walks the last block off a 1080 frame. */
      .stb span { font-size: 92px; line-height: 1.1; padding: 14px 24px; }
      .stmt--blocks .stb { margin-left: 0 !important; }
      .stmt--blocks .stb:nth-child(2) { margin-left: 28px !important; }
      .stmt--blocks .stb:nth-child(3) { margin-left: 56px !important; }
      /* The figure IS the frame: a numeral that fills the width, the label set
         against it rather than under it. */
      .numrow--hero { align-items: flex-end; gap: 24px; }
      /* Onest's ink box runs taller than 1em, so a tight leading on a figure
         this size lets the glyph escape and collide with the eyebrow above and
         the label below — which check caught at 19 sample points. 1.18 is the
         floor that holds at 660px. */
      .numrow--hero .num { font-size: 660px; line-height: 1.18; letter-spacing: -.05em; }
      .unit.xl { font-size: 120px; }
      .label.xl { font-size: 120px; letter-spacing: -.03em; }
      .lay--bignum-hero .sub, .lay--bignum-split .sub { font-size: 46px; max-width: 24ch; }
      /* Two halves of the frame, each with its content centred in its own half —
         hugging the seam left the lower half looking abandoned. */
      .cmp--stack { grid-template-rows: 1fr 8px 1fr; align-content: stretch; height: 100%; }
      .cmp--stack .cmp-col { padding: 0 ${GUTTER + 20}px; justify-content: center; gap: 20px; }
      .cmp-h { font-size: 36px; }
      .cmp-big { font-size: 116px; line-height: 0.98; letter-spacing: -.04em; }
      .cmp-i { font-size: 44px; }
      .li-t { font-size: 76px; }
      .li-n { font-size: 44px; }
      .endtitle { font-size: 96px; }
      .endsub { font-size: 36px; }
      .cta { font-size: 40px; }
      .cell { width: 128px !important; height: 128px !important; }
      .cellrow { gap: 26px; }
      .cell-label { font-size: 52px; }

      /* ── plate: the picture is the point ─────────────────────────────────
         An inset came back as a white card carrying an eyebrow, a small photo,
         a caption and a full credit line — four pieces of text around a
         thumbnail. In portrait it is a picture with a line under it: the
         eyebrow goes, the image takes the card's full width, and the credit
         shrinks to a footnote (it stays, because we do credit the source). */
      .lay--plate-inset .body { height: auto !important; padding: 22px 22px 16px !important; gap: 12px; }
      .lay--plate-inset .eyebrow { display: none; }
      .lay--plate-inset .plate { width: 100%; }
      .lay--plate-inset .plate img { width: 100%; height: auto; max-height: ${Math.round(H * 0.30)}px !important; object-fit: cover; }
      .lay--plate-inset .plate-cap { font: 700 40px/1.28 var(--font-noto); }
      /* A slideshow gets the same treatment as an inset: the picture is the
         point, so the eyebrow goes and the frame takes the card's full width. */
      .lay--plate-slides .eyebrow { display: none; }
      .lay--plate-slides .pslides { aspect-ratio: 4/3; }
      .lay--plate-slides .plate-cap { font: 700 40px/1.28 var(--font-noto); }
      .lay--plate-inset .credit { font-size: 20px; opacity: .62; }
      /* Scenes stack: copy above, pictures below, the pair centred. */
      .pscene { display: grid; grid-template-columns: 1fr; grid-template-rows: auto auto;
        align-content: center; gap: 48px; height: ${H}px; padding: ${Math.round(H * 0.09)}px ${GUTTER + 24}px; }
      .pblk span { font-size: 84px; white-space: normal; }
      .pscene--3 .pblk span, .pscene--4 .pblk span { font-size: 68px; }
      .pcap { font-size: 44px; max-width: 22ch; }
      .srcchip { font-size: 24px; top: -38px; }

      /* ── panels: compact, they live under his chin ───────────────────── */
      /* list:panel is a full-height column in landscape — deliberate there, a
         near-full-frame takeover here. It becomes an ordinary card in the zone. */
      .lay--list-panel .body { height: auto !important; padding: 40px 42px !important;
        justify-content: flex-start !important; }
      /* A day list card's face is parchment, invisible against a parchment
         ground. Panels get the card treatment back. */
      .pxcard--day.lay--list-panel .face { clip-path: ${STEP_CARD} !important; background:
        linear-gradient(var(--white), var(--white)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--chalk) !important; }
      .pxcard--night.lay--list-panel .face { clip-path: ${STEP_CARD} !important; }
      .eyebrow { font-size: 30px; }
      .title { font-size: 48px; }
      .title.small { font-size: 40px; }
      .lp-t { font-size: 36px; }
      .check { font-size: 36px; }
      .tlwhat { font-size: 36px; }
      .tlwhen { font-size: 28px; }
      .sub { font-size: 32px; }

      /* ── captions ────────────────────────────────────────────────────────
         An ink chip that hugs the words. Over parchment a scrim is a grey
         smudge and no text shadow fixes it, because a shadow cannot raise the
         BACKGROUND's luminance. The chip reads over footage, parchment and an
         ink card alike, and :empty hides it between chunks. */
      .caption-scrim { display: none; }
      .caption { left: 50%; right: auto; width: auto; max-width: ${W - 2 * GUTTER}px;
        ${CAP_POS === "top" ? `top: ${CAP_TOP_Y}px; bottom: auto;` : `bottom: ${CAP_BOTTOM}px;`}
        font: 700 54px/1.28 var(--font-noto);
        transform: translateX(-50%); display: inline-block; box-sizing: border-box;
        background: var(--ink); color: var(--white); padding: 16px 30px;
        clip-path: ${STEP_CHIP}; text-shadow: none; }
      .caption:empty { display: none; }
`;


// The banded treatment only (plan.arollFit: "band"): the window, the ground
// it sits on, and the standing furniture that fills the room underneath.
// Full-bleed portrait needs none of it — the footage IS the frame.
const BAND_CSS = !BANDED ? "" : `
      /* ── the banded treatment ──────────────────────────────────────────
         The talking head as a window on the brand ground. Sized so the
         source plays at ${BAND.scale.toFixed(2)}x — object-fit: cover takes the centre
         crop, which is where his face is (the measured box centres on x=${Math.round((FACE.x0 + FACE.x1) / 2)} of ${AROLL_SIZE.w}). */
      .stage-ground { position: absolute; inset: 0; z-index: 0; background:
        linear-gradient(var(--grid-line) 2px, transparent 2px) 0 0 / 56px 56px,
        linear-gradient(90deg, var(--grid-line) 2px, transparent 2px) 0 0 / 56px 56px, var(--parchment); }
      .aroll { position: absolute; left: 0; top: ${BAND.y}px; width: ${W}px; height: ${BAND.h}px; z-index: 1; }
      .aroll video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      /* The window is edge to edge, so an offset slab could only ever peek out
         at the bottom and read as a stray bar. Hard rules top and bottom instead
         — no blur, per the brand. */
      .aroll { box-shadow: 0 5px 0 var(--ink), 0 -5px 0 var(--ink); }
      /* 34% of the runtime is bare talking head, and in portrait that left the
         whole card zone as empty grid. Standing furniture fills it — the question
         the episode is answering, which on a scrolling feed is also the thing a
         viewer most needs to see. Cards and cutaways cover it; it is the frame,
         not a card, so it does not count against the layout variety rules. */
      .standing { position: absolute; left: ${GUTTER}px; top: ${ZONE.top + 10}px; z-index: 0;
        width: ${PANEL_W}px; display: flex; flex-direction: column; gap: 18px; align-items: flex-start; }
      .standing-rule { width: 92px; height: 8px; background: var(--coral); }
      .standing-q { font: 800 52px/1.16 var(--font-onest); letter-spacing: -.025em; color: var(--ink); }
      /* The strip above the window carries the series line. z-index 0, painted
         just above the ground: this is furniture for the
         parchment, not an overlay. Above the footage it measured 1.38:1 during a
         crossfade — a standing label has no business competing with a cutaway. */
      .brand-rail { position: absolute; left: ${GUTTER}px; top: ${Math.round((BAND.y - 34) / 2)}px; z-index: 0;
        font: 400 30px/1 var(--font-pixel); letter-spacing: .10em; text-transform: uppercase; color: var(--mist); }
`;

const html = `<!doctype html>
<html lang="${project.language ?? "en"}">
  <head>
    <meta charset="utf-8" />
    <title>${esc(project.name)} — Nowa video layer</title>
    <style>
${fontfaces.trimEnd()}

      /* ── Nowa tokens (system/nowa/tokens.css) at video scale ────────── */
      :root {
        --coral: #ef493d; --coral-glow: #f87a71; --coral-blush: #fececa; --ember: #b9271c;
        --ink: #161c24; --charcoal: #212b36; --slate: #454f5b; --mist: #637381;
        --cloud: #c4cdd5; --chalk: #dfe3e8; --parchment: #fdf5dd; --ghost: #f4f6f8; --white: #ffffff;
        --amber: #ffc107; --leaf: #54d62c; --success-surface: #e7f6df; --success-ink: #3f7a23;
        --grid-line: rgba(22,28,36,.08); --grid-line-dark: rgba(255,255,255,.06);
        --font-onest: "Onest", ui-sans-serif, system-ui, sans-serif;
        --font-noto: "Noto Sans", ui-sans-serif, system-ui, sans-serif;
        --font-pixel: "Tiny5", monospace;
        --ease-expo: cubic-bezier(0.19, 1, 0.22, 1);
        /* hard offsets only — never blur */
        --px-shadow: 6px 6px 0 rgba(22,28,36,.12);
        --px-shadow-dark: 6px 6px 0 rgba(0,0,0,.28);
        --px-shadow-pop: 12px 12px 0 var(--coral-blush);
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--ink); font-family: var(--font-noto); }
      #stage { position: relative; width: 100%; height: 100%; overflow: hidden; }

            .aroll, .aroll video { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
      .aroll video { object-fit: cover; }
      

      .broll { position: absolute; z-index: 3; pointer-events: none; }
      .broll video { width: 100%; height: 100%; object-fit: cover; display: block; }
      /* Inset footage takes the photo treatment: stepped mask, hard shadow,
         a degree or so of rotate (GRAPHICS.md §4). */
      .broll--inset { filter: drop-shadow(8px 8px 0 rgba(22,28,36,.35)); }
      .broll--inset video { clip-path: ${STEP_CARD}; }

      /* ── cards ────────────────────────────────────────────────────── */
      .card-host { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 5; pointer-events: none; }
      .card-inner { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; opacity: 0; }
      .pxcard { position: absolute; --pxbg: var(--white); --pxborder: var(--chalk); --face-ink: var(--ink); --sub-ink: var(--slate); --accent: var(--coral); --march: var(--ink); }
      .pxcard--night { --pxbg: var(--ink); --pxborder: rgba(255,255,255,.14); --face-ink: var(--white); --sub-ink: var(--cloud); --accent: var(--coral-glow); --march: var(--cloud); }
      /* the §2 pattern: fill drawn 2px inside the border colour, both stepped */
      .pxcard .face { position: absolute; inset: 0; z-index: 0; clip-path: ${STEP_CARD};
        background: linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .pxcard--night .face { background:
        linear-gradient(var(--grid-line-dark) 2px, transparent 2px) 2px 2px / 56px 56px,
        linear-gradient(90deg, var(--grid-line-dark) 2px, transparent 2px) 2px 2px / 56px 56px,
        linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .pxcard--day { filter: drop-shadow(var(--px-shadow)); }
      .pxcard--night { filter: drop-shadow(var(--px-shadow-dark)); }
      .pxcard--lower-third { filter: drop-shadow(var(--px-shadow-pop)); }
      .pxcard .body { position: relative; z-index: 1; padding: 44px 48px; display: flex; flex-direction: column; gap: 20px; color: var(--face-ink); }
      .pxcard--lower-third .body { flex-direction: column; gap: 12px; padding: 32px 44px; }

      .eyebrow { font: 400 28px/1 var(--font-pixel); letter-spacing: .06em; text-transform: uppercase; color: var(--sub-ink); }
      .wordmark { display: block; height: auto; }
      .title { font: 800 56px/1.08 var(--font-onest); letter-spacing: -.025em; color: var(--face-ink); }
      .title.small { font-size: 44px; }
      .sub { font: 400 30px/1.4 var(--font-noto); color: var(--sub-ink); }
      .label { font: 700 34px/1.2 var(--font-onest); letter-spacing: -.01em; color: var(--face-ink); }

      /* bignum — App/Numeral scaled; coral is spent on the figure */
      /* Onest's ink box is taller than 1em: under ~1.2 line-height a 180px
         figure escapes its line box and collides with the eyebrow above and
         the label below (hyperframes check: content_overlap). */
      .numrow { display: flex; align-items: baseline; gap: 16px; }
      .num { font: 800 176px/1.25 var(--font-onest); letter-spacing: -.04em; color: var(--accent); }
      .unit { font: 700 44px/1 var(--font-onest); color: var(--face-ink); }

      /* process — stepped chips joined by marching pixels; the active chip is the coral */
      .steps { display: flex; align-items: center; gap: 0; }
      .stepchip { font: 700 34px/1 var(--font-onest); padding: 22px 28px; clip-path: ${STEP_CHIP}; background: var(--chalk); color: var(--slate); }
      .pxcard--night .stepchip { background: var(--charcoal); color: var(--cloud); }
      .stepchip.done { background: var(--success-surface); color: var(--success-ink); }
      .stepchip.on { background: var(--coral); color: var(--white); }
      .march { flex: 1; height: 6px; min-width: 40px; margin: 0 6px; background: repeating-linear-gradient(90deg, var(--march) 0 12px, transparent 12px 24px); opacity: .7; }
      .steplabels { display: flex; gap: 16px; }
      .steplabel { flex: 1; font: 400 24px/1.3 var(--font-noto); color: var(--sub-ink); }
      .steplabel.on { color: var(--face-ink); font-weight: 600; }

      /* checklist — square-cap check marks, the pixel-line icon language */
      .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px; }
      .check { display: flex; align-items: center; gap: 18px; font: 600 32px/1.25 var(--font-noto); color: var(--face-ink); }
      .check .box { flex: none; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; clip-path: ${step(12)}; background: var(--success-surface); color: var(--success-ink); }
      .pxcard--night .check .box { background: var(--success-ink); color: var(--white); }

      .callout { font: 800 48px/1.15 var(--font-onest); letter-spacing: -.02em; color: var(--face-ink); }

      /* timeline — dots on a rail, the active milestone in coral */
      .tl { display: flex; flex-direction: column; gap: 22px; }
      .tlrow { display: grid; grid-template-columns: 24px 1fr; grid-template-rows: auto auto; column-gap: 20px; align-items: center; }
      .tldot { width: 24px; height: 24px; clip-path: ${step(8)}; background: var(--chalk); grid-row: 1 / span 2; }
      .pxcard--night .tldot { background: var(--charcoal); }
      .tlrow.done .tldot { background: var(--success-ink); }
      .tlrow.on .tldot { background: var(--accent); }
      .tlwhen { font: 700 26px/1.2 var(--font-onest); letter-spacing: .02em; text-transform: uppercase; color: var(--sub-ink); }
      .tlrow.on .tlwhen { color: var(--accent); }
      .tlwhat { font: 600 32px/1.2 var(--font-noto); color: var(--face-ink); }

      /* endcard — full ink night section; the CTA is the frame's one coral */
      .pxcard--endcard { filter: none; }
      .pxcard--endcard .face { clip-path: none; background:
        linear-gradient(var(--grid-line-dark) 2px, transparent 2px) 0 0 / 56px 56px,
        linear-gradient(90deg, var(--grid-line-dark) 2px, transparent 2px) 0 0 / 56px 56px, var(--ink); }
      .pxcard--endcard .body { height: ${H}px; align-items: center; justify-content: center; gap: 28px; text-align: center; }
      .endtitle { font: 800 64px/1.1 var(--font-onest); letter-spacing: -.025em; color: var(--white); }
      .endsub { font: 400 32px/1.4 var(--font-noto); color: var(--cloud); max-width: 1100px; }
      .cta { --side: 10px; display: inline-flex; padding: 24px 44px calc(24px + var(--side)); clip-path: ${STEP_CHIP};
        background: linear-gradient(var(--coral), var(--coral)) no-repeat 0 0 / 100% calc(100% - var(--side)), var(--ember);
        font: 700 32px/1 var(--font-onest); color: var(--white); }
      .cta > * { position: relative; z-index: 1; }

      /* ── full-frame types ─────────────────────────────────────────────
         These replace the frame rather than sitting in it. The --over variant
         keeps the footage readable behind a scrim instead of a solid face.
         (No backticks in here: this block lives inside a JS template literal.) */
      .pxcard--statement, .pxcard--list, .pxcard--compare, .pxcard--quote { filter: none; }
      /* A card's face paints its 2px rim in --pxborder, which for night is
         rgba(255,255,255,.14) — SEMI-TRANSPARENT. That is right for a card
         floating on footage and wrong for a surface that IS the frame: the rim
         becomes a 2px window at the frame edge showing whatever is behind. In
         16:9 that leaked a sliver of A-roll and nobody noticed; in portrait it
         leaked the bright parchment ground straight down both edges. So every
         full-frame surface takes a flat, opaque face.
         bignum:hero and :split belong here even though bignum is not in
         FULL_FRAME — the CSS promotes those two layouts to the whole frame. */
      .pxcard--statement .face, .pxcard--list .face, .pxcard--compare .face, .pxcard--quote .face, .pxcard--plate .face,
      .lay--bignum-hero .face, .lay--bignum-split .face {
        clip-path: none; background: var(--pxbg);
      }
      /* The ground drifts for the card's whole life so a long hold is never a
         still frame. Oversized so the drift never exposes an edge. */
      .cdrift { position: absolute; left: -120px; top: -120px;
        width: calc(100% + 240px); height: calc(100% + 240px); z-index: 0; pointer-events: none;
        background-image: linear-gradient(var(--grid-line-dark) 2px, transparent 2px),
                          linear-gradient(90deg, var(--grid-line-dark) 2px, transparent 2px);
        background-size: 56px 56px; }
      .pxcard--day .cdrift { background-image: linear-gradient(var(--grid-line) 2px, transparent 2px),
                          linear-gradient(90deg, var(--grid-line) 2px, transparent 2px); }
      .pxcard--over .cdrift { display: none; }
      .pxcard--day.pxcard--statement .face, .pxcard--day.pxcard--list .face,
      .pxcard--day.pxcard--compare .face, .pxcard--day.pxcard--quote .face, .pxcard--day.pxcard--plate .face {
        background: var(--parchment);
        --face-ink: var(--ink); --sub-ink: var(--slate);
      }
      /* over footage: a scrim, not a fill */
      .pxcard--over .face { background: rgba(22, 28, 36, 0.74) !important; }
      .pxcard--over.pxcard--day .face { background: rgba(253, 245, 221, 0.9) !important; }
      .pxcard--statement .body, .pxcard--list .body, .pxcard--quote .body, .pxcard--plate .body {
        height: ${H}px; justify-content: center; padding: 110px 140px; gap: 30px;
      }
      .pxcard--plate .body { align-items: center; }
      .lay--plate-inset .body { height: auto !important; padding: 34px 32px !important; align-items: stretch; gap: 18px; }
      .lay--plate-inset .face { clip-path: ${STEP_CARD}; background:
        linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder) !important; }

      /* statement — one thought, masked lines rising */
      .stmt { display: flex; flex-direction: column; gap: 6px; }
      .stmt-mask { overflow: hidden; padding-bottom: 6px; }
      .stmt-line { font: 800 88px/1.14 var(--font-onest); letter-spacing: -.035em; color: var(--face-ink); }
      .stmt-sub { font: 400 34px/1.4 var(--font-noto); color: var(--sub-ink); max-width: 1200px; }

      /* list — full-frame, coral numerals, a rule between rows */
      .list-title { font: 800 54px/1.1 var(--font-onest); letter-spacing: -.025em; color: var(--face-ink); }
      .li-wrap { display: flex; flex-direction: column; }
      .li { display: grid; grid-template-columns: 108px 1fr; align-items: baseline; column-gap: 34px;
        padding: 26px 0; border-bottom: 2px solid var(--pxborder); }
      /* unnumbered: no numeral column to leave hanging empty */
      .li-wrap.bare .li { grid-template-columns: 1fr; }
      .li-wrap.bare .li-note { grid-column: 1; }
      .li:last-child { border-bottom: 0; }
      .li-n { font: 800 44px/1 var(--font-onest); letter-spacing: -.02em; color: var(--accent); }
      .li-t { font: 700 52px/1.15 var(--font-onest); letter-spacing: -.02em; color: var(--face-ink); }
      .li-note { grid-column: 2; font: 400 30px/1.35 var(--font-noto); color: var(--sub-ink); margin-top: 8px; }

      /* compare — two columns, a hard seam, coral on the winning side */
      .pxcard--compare .body { height: ${H}px; padding: 0; }
      .cmp { display: grid; grid-template-columns: 1fr 8px 1fr; height: 100%; }
      .cmp-seam { background: var(--ink); }
      .pxcard--night .cmp-seam { background: var(--cloud); }
      .cmp-col { display: flex; flex-direction: column; justify-content: center; gap: 26px; padding: 90px 80px; }
      .cmp-h { font: 400 30px/1 var(--font-pixel); letter-spacing: .06em; text-transform: uppercase; color: var(--sub-ink); }
      .cmp-big { font: 800 76px/1.08 var(--font-onest); letter-spacing: -.03em; color: var(--face-ink); }
      .cmp-i { font: 600 34px/1.35 var(--font-noto); color: var(--sub-ink); }
      .cmp-col.win .cmp-big { color: var(--accent); }
      .cmp-col.win .cmp-i { color: var(--face-ink); }

      /* quote — his sentence, brightening word by word */
      .quote-rule { width: 180px; height: 10px; background: var(--accent); transform-origin: 0 50%; }
      .quote { font: 700 72px/1.25 var(--font-onest); letter-spacing: -.03em; color: var(--face-ink); max-width: 1500px; }
      .quote .qw { display: inline-block; }
      .quote-attrib { font: 400 30px/1 var(--font-noto); color: var(--sub-ink); }

      /* ── no-text graphics ─────────────────────────────────────────────── */
      .pxcard--annotate, .pxcard--cells { background: transparent; filter: none; }
      .pxcard--annotate .face, .pxcard--cells .face { display: none; }
      .pxcard--annotate .body, .pxcard--cells .body { padding: 0; height: ${H}px; }
      .anno { position: absolute; left: 0; top: 0; }
      /* square caps + a 3px-scale stroke: the pixel-line icon language at
         video size (ICONS.md — never round caps). */
      .anno .mk, .anno .mk-head {
        stroke: var(--coral); stroke-width: 8; stroke-linecap: square; stroke-linejoin: miter;
        stroke-dasharray: 100; fill: none;
        filter: drop-shadow(0 3px 10px rgba(22,28,36,.45));
      }
      .anno-label { position: absolute; font: 700 34px/1.2 var(--font-onest); color: var(--white);
        text-shadow: 3px 3px 0 rgba(22,28,36,.9); }

      /* Overlay graphics sit in the lower third: dead centre lands on the face. */
      .pxcard--cells .body { align-items: center; justify-content: flex-end; padding-bottom: 330px; gap: 30px; }
      .cellrow { display: flex; gap: 22px; }
      .cell { width: 96px; height: 96px; clip-path: ${step(16)}; background: rgba(255,255,255,.16); }
      .cell.lit { background: var(--coral); }
      .cell-label { font: 700 40px/1.2 var(--font-onest); color: var(--white); text-shadow: 3px 3px 0 rgba(22,28,36,.85); }

      /* ── layout library ───────────────────────────────────────────────
         Alternative presentations of the same data. Class is lay--TYPE-LAYOUT.
         See bin/layouts.mjs for a rendered contact sheet of every one. */

      /* lower-third · rule */
      .lt-rule { width: 120px; height: 8px; background: var(--accent); }

      /* bignum · hero — the figure is the frame */
      .lay--bignum-hero { left: 0 !important; top: 0 !important; width: ${W}px !important; height: ${H}px !important; transform: none !important; filter: none; }
      .lay--bignum-hero .face { clip-path: none; }
      .lay--bignum-hero .body { height: ${H}px; justify-content: center; padding: 0 140px; }
      /* Onest's ink box runs taller than 1em; at 400px a tight leading lets the
         glyph escape and collide with the eyebrow above and the label below. */
      .numrow--hero .num { font-size: 380px; line-height: 1.22; }
      .unit.xl { font-size: 96px; }
      .label.xl { font-size: 64px; }

      /* bignum · split — figure and words either side of a seam */
      .lay--bignum-split { left: 0 !important; top: 0 !important; width: ${W}px !important; height: ${H}px !important; transform: none !important; filter: none; }
      .lay--bignum-split .face { clip-path: none; }
      .lay--bignum-split .body { height: ${H}px; padding: 0; }
      .bn-split { display: grid; grid-template-columns: 1fr 8px 1fr; height: 100%; align-items: center; }
      .bn-l { display: flex; align-items: baseline; justify-content: center; gap: 16px; }
      .bn-l .num { font-size: 290px; line-height: 1.24; }
      .bn-seam { background: var(--pxborder); height: 100%; }
      .bn-r { display: flex; flex-direction: column; gap: 20px; padding: 0 96px; }

      /* bignum · meter */
      .meter { width: 100%; height: 26px; background: var(--pxborder); clip-path: ${step(8)}; overflow: hidden; }
      .meter-fill { display: block; height: 100%; background: var(--accent); }

      /* list · panel — compact rows for a corner panel */
      .lp { display: flex; flex-direction: column; gap: 14px; }
      .lp-row { display: grid; grid-template-columns: 54px 1fr; align-items: baseline; column-gap: 18px; }
      .lp-n { font: 800 26px/1.2 var(--font-onest); color: var(--accent); }
      .lp-tick { width: 22px; height: 8px; background: var(--accent); align-self: center; }
      .lp-t { font: 600 34px/1.25 var(--font-noto); color: var(--face-ink); }

      /* list · grid — each item its own stepped tile */
      .lg { display: grid; gap: 26px; width: 100%; }
      .lg-cell { position: relative; min-height: 210px; }
      .lg-face { position: absolute; inset: 0; clip-path: ${step(20)};
        background: linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .pxcard--night .lg-face { background: linear-gradient(var(--charcoal), var(--charcoal)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .lg-body { position: relative; z-index: 1; padding: 34px 32px; display: flex; flex-direction: column; gap: 12px; }
      .lg-n { font: 800 32px/1 var(--font-onest); color: var(--accent); }
      .lg-t { font: 700 40px/1.14 var(--font-onest); letter-spacing: -.02em; color: var(--face-ink); }
      .lg-note { font: 400 26px/1.35 var(--font-noto); color: var(--sub-ink); }

      /* list · stack — no numerals, no rules, very large lines */
      .ls { display: flex; flex-direction: column; gap: 4px; }
      .ls-mask { overflow: hidden; padding-bottom: 6px; }
      .ls-line { font: 800 78px/1.16 var(--font-onest); letter-spacing: -.035em; color: var(--face-ink); }

      /* list · chips — a wrapping cluster of pills */
      .lc { display: flex; flex-wrap: wrap; gap: 20px; }
      .lc-chip { font: 700 42px/1 var(--font-onest); letter-spacing: -.01em; padding: 26px 34px;
        clip-path: ${STEP_CHIP}; background: var(--pxborder); color: var(--face-ink); }
      .pxcard--night .lc-chip { background: var(--charcoal); }
      .lc-chip:nth-child(odd) { background: var(--accent); color: var(--white); }

      /* list · index — oversized numeral beside each line */
      .lx { display: flex; flex-direction: column; gap: 34px; }
      .lx-row { display: grid; grid-template-columns: 190px 1fr; align-items: center; column-gap: 40px; }
      .lx-n { font: 800 130px/0.9 var(--font-onest); letter-spacing: -.05em; color: var(--accent); text-align: right; }
      .lx-b { display: flex; flex-direction: column; gap: 8px; }
      .lx-t { font: 700 56px/1.12 var(--font-onest); letter-spacing: -.025em; color: var(--face-ink); }
      .lx-note { font: 400 28px/1.35 var(--font-noto); color: var(--sub-ink); }

      /* list · columns — across the frame, hairlines between */
      .lco { display: grid; width: 100%; }
      .lco-col { display: flex; flex-direction: column; gap: 16px; padding: 0 44px;
        border-left: 2px solid var(--pxborder); }
      .lco-col:first-child { border-left: 0; padding-left: 0; }
      .lco-n { font: 800 34px/1 var(--font-onest); color: var(--accent); }
      .lco-t { font: 700 46px/1.14 var(--font-onest); letter-spacing: -.025em; color: var(--face-ink); }
      .lco-note { font: 400 27px/1.35 var(--font-noto); color: var(--sub-ink); }

      /* checklist · grid */
      .checks--grid { display: grid; column-gap: 44px; }

      /* process · rail — phases down the frame */
      .prail { display: flex; flex-direction: column; gap: 22px; }
      .prail-row { display: grid; grid-template-columns: 26px 1fr; align-items: center; column-gap: 22px; }
      .prail-dot { width: 26px; height: 26px; clip-path: ${step(8)}; background: var(--pxborder); }
      .prail-t { font: 700 42px/1.1 var(--font-onest); letter-spacing: -.02em; color: var(--sub-ink); }
      .prail-note { grid-column: 2; font: 400 26px/1.3 var(--font-noto); color: var(--sub-ink); }

      /* callout · bar — a coral rule instead of a surface */
      .lay--callout-bar { filter: none; }
      .lay--callout-bar .face { display: none; }
      .lay--callout-bar .body { display: grid; grid-template-columns: 10px 1fr; column-gap: 30px; padding: 8px 0; }
      .co-bar { background: var(--accent); border-radius: 0; }
      .co-body { display: flex; flex-direction: column; gap: 16px;
        text-shadow: 2px 2px 0 rgba(22,28,36,.65); }
      .lay--callout-bar .callout, .lay--callout-bar .sub, .lay--callout-bar .eyebrow { color: var(--white); }

      /* timeline · track — left to right along a rail */
      .ttrack { position: relative; display: flex; justify-content: space-between; padding: 40px 0 0; }
      .ttrack-rail { position: absolute; left: 0; right: 0; top: 52px; height: 6px; background: var(--pxborder); }
      .ttrack-stop { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; max-width: 30%; }
      .ttrack-dot { width: 26px; height: 26px; clip-path: ${step(8)}; background: var(--pxborder); }
      .ttrack-stop.done .ttrack-dot { background: var(--success-ink); }
      .ttrack-stop.on .ttrack-dot { background: var(--accent); }
      .ttrack-when { font: 700 26px/1.2 var(--font-onest); letter-spacing: .02em; text-transform: uppercase; color: var(--sub-ink); }
      .ttrack-stop.on .ttrack-when { color: var(--accent); }
      .ttrack-what { font: 600 34px/1.18 var(--font-noto); color: var(--face-ink); }

      /* statement · center and oversize */
      .stmt--center { align-items: center; text-align: center; }
      .stmt--center .stmt-line { font-size: 76px; }
      .stmt--over .stmt-line { font-size: 132px; line-height: 1.04; letter-spacing: -.05em; }
      .lay--statement-oversize .body { padding: 90px 100px; }

      /* quote · center */
      .quote--center { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 26px; }
      .quote-mark { font: 800 140px/0.6 var(--font-onest); color: var(--accent); }

      /* compare · stack and versus */
      .cmp--stack { grid-template-columns: 1fr; grid-template-rows: 1fr 8px 1fr; }
      .cmp-seam--h { width: 100%; height: 8px; }
      .cmp--vs { display: flex; align-items: center; justify-content: center; gap: 40px; padding: 0 90px; }
      .vs-plate { position: relative; flex: 1; min-height: 620px; }
      .vs-face { position: absolute; inset: 0; clip-path: ${STEP_CARD};
        background: linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .pxcard--night .vs-face { background: linear-gradient(var(--charcoal), var(--charcoal)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .vs-plate.win .vs-face { background: linear-gradient(var(--pxbg), var(--pxbg)) 3px 3px / calc(100% - 6px) calc(100% - 6px) no-repeat, var(--accent); }
      .vs-body { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center;
        height: 100%; gap: 22px; padding: 56px 48px; }
      .vs-pivot { flex: none; font: 800 46px/1 var(--font-onest); color: var(--white);
        background: var(--accent); padding: 22px 26px; clip-path: ${STEP_CHIP}; }

      /* ── sourced imagery ──────────────────────────────────────────────
         A picture that is not ours goes in a frame and carries its credit.
         The builder refuses to place one without an approved source line. */
      .plate { display: flex; justify-content: center; padding: 16px; background: var(--white);
        clip-path: ${STEP_CARD}; filter: drop-shadow(8px 8px 0 rgba(22,28,36,.28)); }
      .plate img { display: block; max-width: 100%; height: auto; clip-path: ${step(12)}; }
      .plate-cap { font: 600 30px/1.35 var(--font-noto); color: var(--face-ink); }
      .plate-cap--over { position: absolute; left: 72px; bottom: 132px; color: var(--white); text-shadow: 3px 3px 0 rgba(22,28,36,.9); }
      .credit { font: 400 22px/1.35 var(--font-noto); color: var(--sub-ink); letter-spacing: .01em; }
      .credit--over { position: absolute; left: 72px; bottom: 96px; color: var(--cloud); text-shadow: 2px 2px 0 rgba(22,28,36,.9); }
      .lay--plate-full { left: 0 !important; top: 0 !important; width: ${W}px !important; height: ${H}px !important; transform: none !important; filter: none; }
      .lay--plate-full .face { display: none; }
      .lay--plate-full .body { padding: 0; height: ${H}px; }
      .lay--plate-full .body::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 240px;
        background: linear-gradient(to bottom, rgba(22,28,36,0), rgba(22,28,36,.82)); }
      .plate-cap--over, .credit--over { z-index: 1; }
      /* Full-bleed means full-bleed. object-fit contain letterboxed every
         picture into a band with ink above and below it, which is the "single
         image just sitting there" look this layout exists to avoid.
         (No backticks in here: this block lives inside a JS template literal.) */
      .plate-bleed { width: ${W}px; height: ${H}px; object-fit: cover; background: var(--ink); }
      /* The only thing on the picture: where it came from. A chip, not a
         sentence — the long credit line belongs on the framed layouts. */
      .bleed-src { position: absolute; left: ${GUTTER}px; bottom: ${VERT ? BOT_SAFE + 24 : 40}px; z-index: 3;
        background: var(--ink); color: var(--white); padding: 8px 16px;
        font: 400 ${VERT ? 26 : 22}px/1.25 var(--font-noto); clip-path: ${STEP_CHIP}; }

      /* cells · grid */
      .cellrow--grid { display: grid; gap: 22px; }

      /* ── the newer presentations ───────────────────────────────────── */

      /* bignum · stack — numeral over an oversized label */
      .bn-stack { display: flex; flex-direction: column; gap: 2px; }
      .bn-stack-label { font: 800 84px/1.02 var(--font-onest); letter-spacing: -.04em; color: var(--face-ink); }

      /* bignum · fraction — value over total */
      .bn-frac { display: inline-flex; flex-direction: column; align-items: center; gap: 8px; }
      .bn-frac-n { font: 800 190px/0.98 var(--font-onest); letter-spacing: -.04em; color: var(--accent); }
      .bn-frac-bar { width: 100%; min-width: 260px; height: 8px; background: var(--face-ink); }
      .bn-frac-d { font: 700 76px/1 var(--font-onest); letter-spacing: -.03em; color: var(--face-ink); }

      /* list · steps — a staircase */
      .lst { display: flex; flex-direction: column; gap: 20px; }
      .lst-row { display: grid; grid-template-columns: 34px 1fr; align-items: baseline; column-gap: 24px; }
      .lst-tick { width: 34px; height: 10px; background: var(--accent); }
      .lst-t { font: 700 52px/1.14 var(--font-onest); letter-spacing: -.025em; color: var(--face-ink); }
      .lst-note { grid-column: 2; font: 400 27px/1.35 var(--font-noto); color: var(--sub-ink); }

      /* callout · sticker — rotated, hard shadow, coral face */
      .lay--callout-sticker { transform: rotate(-2.2deg) !important; filter: drop-shadow(10px 10px 0 rgba(22,28,36,.34)); }
      .lay--callout-sticker .face { background:
        linear-gradient(var(--coral), var(--coral)) 3px 3px / calc(100% - 6px) calc(100% - 6px) no-repeat, var(--ember) !important; }
      .lay--callout-sticker .callout, .lay--callout-sticker .sub, .lay--callout-sticker .eyebrow { color: var(--white); }

      /* statement · blocks — each line a stamped block, stepped down */
      .stmt--blocks { gap: 14px; align-items: flex-start; }
      .stb { display: inline-block; }
      .stb span { display: inline-block; padding: 14px 26px; clip-path: ${STEP_CHIP};
        background: var(--face-ink); color: var(--pxbg);
        font: 800 76px/1.16 var(--font-onest); letter-spacing: -.035em; }
      .stb:nth-child(even) span { background: var(--accent); color: var(--white); }

      /* quote · card — the sentence in a stepped card on the footage */
      .qcard { position: relative; margin: 0 auto; max-width: 1360px; }
      .qcard-face { position: absolute; inset: 0; clip-path: ${STEP_CARD};
        background: linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder); }
      .qcard-body { position: relative; z-index: 1; padding: 56px 60px; display: flex; flex-direction: column; gap: 24px; }
      .lay--quote-card { filter: drop-shadow(10px 10px 0 rgba(22,28,36,.34)); }
      .lay--quote-card .quote { font-size: 58px; }

      /* compare · bars */
      .cbars { display: flex; flex-direction: column; justify-content: center; gap: 56px; height: 100%; padding: 0 130px; }
      .cbar-row { display: flex; flex-direction: column; gap: 16px; }
      .cbar-h { font: 400 30px/1 var(--font-pixel); letter-spacing: .06em; text-transform: uppercase; color: var(--sub-ink); }
      .cbar-track { width: 100%; height: 54px; background: var(--pxborder); clip-path: ${step(12)}; }
      .cbar-fill { display: block; height: 100%; background: var(--sub-ink); }
      .cbar-row.win .cbar-fill { background: var(--accent); }
      .cbar-b { font: 800 52px/1.1 var(--font-onest); letter-spacing: -.03em; color: var(--face-ink); }
      .cbar-note { font: 400 30px/1.3 var(--font-noto); color: var(--sub-ink); letter-spacing: 0; }

      /* plate · polaroid — a tilted print on a mount */
      .polaroid { display: inline-block; background: var(--white); padding: 22px 22px 0; transform: rotate(-1.6deg);
        clip-path: ${STEP_CARD}; filter: drop-shadow(10px 10px 0 rgba(22,28,36,.3)); }
      .polaroid img { display: block; max-width: 100%; height: auto; }
      .polaroid-strip { padding: 20px 6px 24px; display: flex; flex-direction: column; gap: 6px; }
      .polaroid-strip .plate-cap { color: var(--ink); }
      .polaroid-strip .credit { color: var(--mist); }

      /* endcard · split */
      .end-split { display: grid; grid-template-columns: 1fr 8px 1fr; height: ${H}px; align-items: center; }
      .end-l { display: flex; align-items: center; justify-content: center; }
      .end-seam { background: rgba(255,255,255,.18); height: 60%; }
      .end-r { display: flex; flex-direction: column; gap: 24px; padding: 0 90px; align-items: flex-start; }
      .lay--endcard-split .body { padding: 0; }

      /* cells · bar */
      .cellrow--bar { gap: 6px; }
      .cellrow--bar .cell { width: 62px; height: 118px; }

      /* annotate · spotlight */
      .anno--spot .mk { stroke: var(--coral); stroke-width: 6; stroke-dasharray: 100; }

      /* ── image scenes ─────────────────────────────────────────────────
         The templates: parchment graph ground, copy stacked in ink/coral
         blocks on the left, framed pictures on the right, each carrying its
         own source chip. Everything is vertically centred — nothing sits in
         the top corner, because these take the whole frame. */
      .lay--plate-hero .body, .lay--plate-duo .body, .lay--plate-trio .body,
      .lay--plate-quad .body, .lay--plate-wide .body {
        padding: 0 !important; height: ${H}px; align-items: stretch !important; justify-content: stretch;
      }
            .pscene { display: grid; grid-template-columns: 640px 1fr; align-items: center;
        gap: 48px; height: ${H}px; padding: 88px 72px; }
      .pscene--3, .pscene--4 { grid-template-columns: 490px 1fr; }
      
      .pcopy { display: flex; flex-direction: column; gap: 20px; align-items: flex-start; }
      .pblocks { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
      .pblk span { display: inline-block; padding: 12px 22px; clip-path: polygon(0 6px,3px 6px,3px 3px,6px 3px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 3px,calc(100% - 3px) 3px,calc(100% - 3px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 3px) calc(100% - 6px),calc(100% - 3px) calc(100% - 3px),calc(100% - 6px) calc(100% - 3px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 3px),3px calc(100% - 3px),3px calc(100% - 6px),0 calc(100% - 6px));
        background: var(--ink); color: var(--white);
        font: 800 54px/1.18 var(--font-onest); letter-spacing: -.03em; white-space: nowrap; }
      .pscene--3 .pblk span, .pscene--4 .pblk span { font-size: 46px; }
      .pblk:nth-child(even) span { background: var(--coral); }
      .pcap { font: 400 32px/1.4 var(--font-noto); color: var(--slate); max-width: 34ch; }

      .part { display: flex; align-items: center; justify-content: center; height: 100%; }
      /* a framed picture: white mount, stepped corners, hard offset shadow */
.pfig { position: relative; display: inline-block; }
      .pmount { display: block; width: 100%; height: 100%; background: var(--white); padding: 10px;
        clip-path: polygon(0 12px,6px 12px,6px 6px,12px 6px,12px 0,calc(100% - 12px) 0,calc(100% - 12px) 6px,calc(100% - 6px) 6px,calc(100% - 6px) 12px,100% 12px,100% calc(100% - 12px),calc(100% - 6px) calc(100% - 12px),calc(100% - 6px) calc(100% - 6px),calc(100% - 12px) calc(100% - 6px),calc(100% - 12px) 100%,12px 100%,12px calc(100% - 6px),6px calc(100% - 6px),6px calc(100% - 12px),0 calc(100% - 12px));
        filter: drop-shadow(9px 9px 0 var(--ink)); box-sizing: border-box; }
      .pfig img, .pfig video { display: block; width: 100%; height: 100%; object-fit: cover; }
      /* a slideshow: every picture in the same mount, one visible at a time */
      .pslides { position: relative; width: 100%; }
      .pslide { position: absolute; inset: 0; opacity: 0; }
      .pslide.on { opacity: 1; }
      .pslide .pmount { width: 100%; height: 100%; }
      /* Slides share ONE box, so they cannot each take their own aspect the way
         a single plate can. object-fit: contain instead of cover: a portrait
         phone shot and a landscape one both show whole, letterboxed on the white
         mount — which on a card reads as a photo album rather than a mistake.
         cover cropped the first slide down to its background. */
      .pslide .pmount img, .pslide .pmount video {
        display: block; width: 100%; height: 100%; object-fit: contain; }
      .lay--plate-slides .face { clip-path: ${STEP_CARD}; background:
        linear-gradient(var(--pxbg), var(--pxbg)) 2px 2px / calc(100% - 4px) calc(100% - 4px) no-repeat, var(--pxborder) !important; }
      .lay--plate-slides .body { height: auto !important; padding: 22px 22px 16px !important; gap: 12px; }
      /* the credit sits ON the picture, top-right, where the templates put it */
      .srcchip { position: absolute; top: -34px; right: 0; z-index: 2;
        background: var(--ink); color: var(--white); padding: 6px 12px;
        font: 400 22px/1.25 var(--font-noto); white-space: nowrap; }

      .pscene--1 .pfig--main { width: 100%; aspect-ratio: var(--fig-ar, 16/9); }
      .pstack2 { position: relative; width: 100%; padding-bottom: 90px; }
      .pstack2 .pfig--main { width: 84%; aspect-ratio: var(--fig-ar, 16/9); }
      .pstack2 .pfig--sec { position: absolute; right: 0; bottom: 0; width: 46%; aspect-ratio: var(--fig-ar, 16/9); }
      .pstack3 { display: grid; grid-template-columns: 1.45fr 1fr; gap: 40px; align-items: center; width: 100%; }
      .pstack3 .pfig--main { width: 100%; aspect-ratio: var(--fig-ar, 16/9); }
      .pcol { display: flex; flex-direction: column; gap: 54px; }
      .pcol .pfig--small { width: 100%; aspect-ratio: var(--fig-ar, 16/9); }
      .pstack4 { display: flex; flex-direction: column; gap: 56px; width: 100%; align-items: flex-end; }
      .pstack4 .pfig--main { width: 78%; aspect-ratio: var(--fig-ar, 16/9); }
      .prow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; width: 100%; }
      .prow .pfig--small { width: 100%; aspect-ratio: var(--fig-ar, 16/9); }

      /* wide — the picture takes the frame, the copy tucks into a corner */
      .pscene--wide { grid-template-columns: 1fr; padding: 70px 96px 96px; position: relative; }
      .pfig--wide { width: 76%; aspect-ratio: var(--fig-ar, 16/9); margin: 0 0 0 auto; }
      .pcopy--corner { position: absolute; left: 96px; bottom: 110px; gap: 12px; }
      .pcopy--corner .pblk span { font-size: 34px; padding: 8px 14px; }
      .pcopy--corner .pcap { font-size: 26px; max-width: 26ch; }

      /* ── captions ──────────────────────────────────────────────────── */
      /* A caption over bright footage (white devices on red foam) measures
         2.8:1 and fails AA no matter how heavy the text shadow is — a shadow
         does not raise the background's luminance. So the caption band gets a
         gradient scrim: not a box (the design system rules those out), just a
         darkening toward the bottom edge. It sits above the footage and below
         the cards, so a full-frame card hides it. */
      .caption-scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 260px; z-index: 4;
        background: linear-gradient(to bottom, rgba(22,28,36,0) 0%, rgba(22,28,36,.42) 55%, rgba(22,28,36,.78) 100%);
        pointer-events: none; }
      .caption { position: absolute; left: 260px; right: 260px; bottom: 64px; text-align: center; z-index: 6; pointer-events: none;
        font: 600 46px/1.25 var(--font-noto); color: var(--white); letter-spacing: -.005em;
        text-shadow: 3px 3px 0 rgba(22,28,36,.9), -1px -1px 0 rgba(22,28,36,.55), 1px -1px 0 rgba(22,28,36,.55), -1px 1px 0 rgba(22,28,36,.55); }
      .caption b.k { color: var(--coral-glow); font-weight: 800; }
      .caption b.kw { font-weight: 800; font-family: var(--font-onest); }

${PORTRAIT_CSS}${BAND_CSS}
    </style>
  </head>
  <body>
    <div id="stage" data-composition-id="nowa-update" data-start="0" data-duration="${DUR}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
${BANDED ? `      <div class="stage-ground"></div>
${plan.rail ? `      <div class="brand-rail" data-layout-allow-occlusion>${esc(plan.rail)}</div>
` : ""}${plan.standing ? `      <div class="standing" data-layout-allow-occlusion><div class="standing-rule"></div><div class="standing-q">${esc(plan.standing)}</div></div>
` : ""}` : ""}      <div class="aroll">
        <video id="aroll" src="aroll.mp4" muted playsinline data-start="0" data-duration="${AROLL_DUR}" data-track-index="1"></video>
      </div>
      <audio id="aroll-audio" src="aroll.mp4" data-start="0" data-duration="${AROLL_DUR}" data-track-index="10" data-volume="1"></audio>

${brollHosts.join("\n\n")}

${cardHosts.join("\n\n")}

${CAP_ON ? `      <div class="caption-scrim"></div>
      <div id="caption" class="caption"></div>` : ""}

      <script src="vendor/gsap.min.js"></script>
      <script>
        (function () {
          window.__fmt = function (v, fmt) {
            if (fmt === ',d') return Math.round(v).toLocaleString('en-US');
            if (typeof fmt === 'string' && /^\\.[0-9]+f$/.test(fmt)) return Number(v).toFixed(Number(fmt.slice(1, -1)));
            return String(Math.round(v));
          };
          var tl = window.gsap.timeline({ paused: true });

${tl.join("\n")}

${capSets}

          window.__timelines = window.__timelines || {};
          window.__timelines['nowa-update'] = tl;
        })();
      </script>
    </div>
  </body>
</html>
`;

await writeFile(join(OUT, "index.html"), html);
await writeFile(join(OUT, "plan.resolved.json"), JSON.stringify({ duration: DUR, arollDuration: AROLL_DUR, brolls: brolls.map(({ clip, ...e }) => ({ ...e, clip: clip.id })), cards: cards.map((c) => ({ beat: c.beat, type: c.type, layout: c.layout, at: c.at, dur: c.dur, theme: c.theme, side: c.side, v: c.v ?? null })) }, null, 2));

// ── rhythm report ─────────────────────────────────────────────────────────
// The build checks its own pacing, so the rules hold on every edit instead of
// depending on whoever wrote the plan noticing.
const brollSec = brolls.reduce((s, e) => s + e.dur, 0);
const fullSec = brolls.filter((e) => e.treatment !== "inset").reduce((s, e) => s + e.dur, 0);
const cardSec = cards.reduce((s, c) => s + c.dur, 0);

// Merge everything that changes the frame into one covered set, then measure
// the gaps: those are the stretches where the viewer only has a talking head.
const spans = [...brolls.map((e) => [e.at, e.at + e.dur]), ...cards.map((c) => [c.at, c.at + c.dur])].sort((a, b) => a[0] - b[0]);
const covered = [];
for (const [a, b] of spans) {
  const last = covered[covered.length - 1];
  if (last && a <= last[1] + 0.01) last[1] = Math.max(last[1], b);
  else covered.push([a, b]);
}
let bare = [], t = 0;
for (const [a, b] of covered) { if (a > t) bare.push([t, a]); t = Math.max(t, b); }
if (AROLL_DUR > t) bare.push([t, AROLL_DUR]);
const bareSec = bare.reduce((s, [a, b]) => s + (b - a), 0);
const worst = bare.slice().sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];

// Variety is counted on TYPE:LAYOUT, not type — two lists in different layouts
// are two different things to look at, which is the whole point of the library.
const types = {};
for (const c of cards) { const k = `${c.type}:${c.layout}`; types[k] = (types[k] ?? 0) + 1; }
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

console.log(`\n${plan.beats.length} beats · ${brolls.length} cutaways (${brollSec.toFixed(0)}s = ${(100 * brollSec / AROLL_DUR).toFixed(0)}%, of which ${fullSec.toFixed(0)}s full-frame; ${cut} cut, ${cached} cached) · ${cards.length} cards (${cardSec.toFixed(0)}s) · captions ${CAP_ON ? "on" : "off"}`);
console.log(`shot lengths: ${brolls.map((e) => e.dur.toFixed(1)).join(" ")} (floor ${HOLD.full}s full / ${HOLD.inset}s inset)`);
console.log(`card types: ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("  ")}`);
console.log(`talking head alone: ${bareSec.toFixed(0)}s = ${(100 * bareSec / AROLL_DUR).toFixed(0)}%` + (worst ? `, longest ${(worst[1] - worst[0]).toFixed(0)}s at ${mmss(worst[0])}` : ""));

// Rules, checked
for (const [a, b] of bare) if (b - a > MAX_BARE) warn.push(`RHYTHM: ${(b - a).toFixed(0)}s of unbroken talking head at ${mmss(a)}–${mmss(b)} (limit ${MAX_BARE}s) — needs a cutaway or a card`);
if (bareSec / AROLL_DUR > MAX_UNAUGMENTED) warn.push(`RHYTHM: ${(100 * bareSec / AROLL_DUR).toFixed(0)}% of the runtime is bare talking head (limit ${(100 * MAX_UNAUGMENTED).toFixed(0)}%)`);
for (const [ty, n] of Object.entries(types)) if (cards.length >= 4 && n / cards.length > MAX_TYPE_SHARE) warn.push(`VARIETY: ${n} of ${cards.length} cards are "${ty}" (${(100 * n / cards.length).toFixed(0)}%, limit ${(100 * MAX_TYPE_SHARE).toFixed(0)}%) — vary the presentation`);

// ── cadence, when a style asked for one ──────────────────────────────────
// A style is only worth setting if something checks it. These two numbers are
// what the person was actually asked for — how often to cut away and how long
// to hold — measured off the built edit and reported against what they said.
// Tolerance is deliberately wide (40%): the answer is an intent, not a metre,
// and a plan that hits it to the second would be a plan that ignored the words.
if (project.style) {
  const wantEvery = project.style.brollEverySec, wantHold = project.style.brollHoldSec;
  const gotHold = brolls.length ? brollSec / brolls.length : 0;
  // Cutaways per minute is the honest way to express "every N seconds": it does
  // not pretend the gaps are evenly spaced, which they never are and should not be.
  const gotEvery = brolls.length ? AROLL_DUR / brolls.length : Infinity;
  console.log(`style "${project.style.label ?? project.style.name}": asked for a cutaway every ~${wantEvery}s holding ~${wantHold}s` +
    (brolls.length ? ` — got one every ${gotEvery.toFixed(0)}s holding ${gotHold.toFixed(1)}s` : " — got none"));
  const off = (got, want) => Math.abs(got - want) / want;
  if (!brolls.length)
    warn.push(`STYLE: the style asks for a cutaway every ~${wantEvery}s and the edit has none`);
  else {
    if (off(gotEvery, wantEvery) > 0.4)
      warn.push(`STYLE: cutaways land every ${gotEvery.toFixed(0)}s; "${project.style.label}" asks for every ~${wantEvery}s` +
        (gotEvery > wantEvery ? " — the edit is thinner than the style you chose" : " — busier than the style you chose"));
    if (off(gotHold, wantHold) > 0.4)
      warn.push(`STYLE: cutaways average ${gotHold.toFixed(1)}s; "${project.style.label}" asks for ~${wantHold}s each`);
  }
}
// ── balance: full frame vs the speaker ───────────────────────────────────
{
  // The full-frame cap is about TEXT taking the screen away from the speaker:
  // past a quarter of the runtime the video stops being a person talking and
  // becomes a slideshow with narration. A short full-bleed PHOTOGRAPH is not
  // that — it is a cutaway that happens to be a still, and it counts with the
  // B-roll instead. Without this distinction, adding the pictures the script
  // actually calls for trips a rule written about walls of type.
  const isPictureCut = (c) => isFull(c) && c.media?.length && c.dur <= (RHYTHM.stillCutaway ?? 5);
  const fullSpans = cards.filter((c) => isFull(c) && !isPictureCut(c)).map((c) => [c.at, c.at + c.dur]);
  const fullSec = fullSpans.reduce((n2, [a, b]) => n2 + (b - a), 0);
  const stillSec = cards.filter(isPictureCut).reduce((n2, c) => n2 + c.dur, 0);
  const panelSec = cards.filter((c) => !isFull(c) && !OVERLAY.has(c.type)).reduce((n2, c) => n2 + c.dur, 0);
  console.log(`card balance: ${fullSec.toFixed(0)}s full-frame (${(100 * fullSec / AROLL_DUR).toFixed(0)}%) · ${panelSec.toFixed(0)}s panels (${(100 * panelSec / AROLL_DUR).toFixed(0)}%)` +
    (stillSec ? ` · ${stillSec.toFixed(0)}s full-bleed stills (counted as cutaways)` : ""));
  if (fullSec / AROLL_DUR > MAX_FULL_SHARE) {
    warn.push(`BALANCE: ${(100 * fullSec / AROLL_DUR).toFixed(0)}% of the runtime is full-frame cards (limit ${(100 * MAX_FULL_SHARE).toFixed(0)}%) — the speaker is off screen too long; move some to panel layouts`);
  }
  const fulls = cards.filter((c) => isFull(c) && !isPictureCut(c));
  for (let i = 1; i < fulls.length; i++) {
    const gap = fulls[i].at - (fulls[i - 1].at + fulls[i - 1].dur);
    // Anything else on screen between them — a panel, a cutaway, or just him —
    // breaks the takeover. Only a near-touching pair is one long absence.
    if (gap < 3) warn.push(`BALANCE: ${fulls[i - 1].beat} runs straight into ${fulls[i].beat} (${gap.toFixed(1)}s apart) — that is ${(fulls[i - 1].dur + gap + fulls[i].dur).toFixed(0)}s without the speaker`);
  }
  for (const c of cards) {
    if (OVERLAY.has(c.type) || c.type === "endcard") continue;
    // quote brightens word by word and cells fill one at a time — both are
    // already timed to the speech, whatever the plan says.
    if (c.type === "quote" || c.type === "cells") continue;
    if (!c.reveal?.length && c.dur > MAX_STATIC_HOLD && !c.media?.some((m) => m.kind === "video") && !(c.slideCount > 1)) {
      warn.push(`MOTION: ${c.beat} ${c.type}:${c.layout} holds ${c.dur.toFixed(0)}s with nothing timed to the words — add "reveal" anchors or shorten it`);
    }
  }
}

for (let i = MAX_TYPE_RUN; i < cards.length; i++) {
  const run = cards.slice(i - MAX_TYPE_RUN, i + 1);
  if (run.every((c) => `${c.type}:${c.layout}` === `${run[0].type}:${run[0].layout}`)) warn.push(`VARIETY: ${run.length} "${run[0].type}:${run[0].layout}" cards in a row (${run.map((c) => c.beat).join(", ")}) — swap one for another layout`);
}
{
  const avail = Object.entries(renderers).reduce((n, [, v]) => n + Object.keys(v).length, 0);
  const distinct = new Set(cards.map((c) => `${c.type}:${c.layout}`));
  console.log(`layout library: ${distinct.size} of ${avail} presentations used  (node bin/layouts.mjs to see them all)`);
  if (VERT && !BANDED) {
    const real = Math.round((SRC_SIZE.h * W) / H);
    console.log(`portrait ${W}x${H}: A-roll full-bleed, cropped to 9:16 — ${real}x${SRC_SIZE.h} real pixels scaled ${(W / real).toFixed(2)}x` +
      ` (lanczos + unsharp, not the browser's bilinear)`);
    console.log(`face box maps to x ${FACE_FRAME.x0}-${FACE_FRAME.x1}, y ${FACE_FRAME.y0}-${FACE_FRAME.y1} — he owns the middle`);
    console.log(`captions ${CAP_POS === "top" ? `above him, top edge y=${CAP_TOP_Y}` : `below, ending at y=${H - CAP_BOTTOM}`}` +
      ` · panels ${PANEL_W}px wide in the band ${ZONE.top}-${ZONE.bot}px · platform UI owns the last ${BOT_SAFE}px`);
    if (swapped.length) console.log(`stacked for portrait: ${swapped.join("  ")}`);
  }
  if (BANDED) {
    console.log(`portrait ${W}x${H}: A-roll band ${W}x${BAND.h} at y=${BAND.y}, source ${SRC_SIZE.w}x${SRC_SIZE.h} shown at ${BAND.scale.toFixed(2)}x` +
      `${BAND.sideCropPct > 0.5 ? `, sides cropped ${BAND.sideCropPct.toFixed(0)}%` : ""}` +
      `  (1:1 would be ${BAND.oneToOne}px)`);
    console.log(`card zone ${BAND.y + BAND.h + 40}-${H - BOT_SAFE}px, panels ${PANEL_W}px wide, captions clear the bottom ${BOT_SAFE}px`);
    if (swapped.length) console.log(`stacked for portrait: ${swapped.join("  ")}`);
  }
  const want = minDistinct(cards.length);
  if (cards.length >= 5 && distinct.size < want) {
    warn.push(`VARIETY: ${cards.length} cards but only ${distinct.size} distinct presentations (want ${want}+ of ${avail}) — open layouts/index.html and spend the library`);
  }
  if (AROLL_DUR > SOURCED_HINT_AFTER && !cards.some((c) => c.type === "plate")) {
    warn.push(`SOURCING: ${(AROLL_DUR / 60).toFixed(0)} min and no sourced picture — run bin/image-search.mjs --from-transcript to see what he names that we cannot show`);
  }
}
console.log(`wrote ${OUT}/index.html (${(html.length / 1024).toFixed(0)} KB), duration ${DUR}s`);
if (warn.length) console.log(`\n${warn.length} notes:\n  ` + warn.join("\n  "));

/*
edit-plan.json
{
  "aroll": "out/01_aroll_clean.mp4",
  "transcript": "work/transcript.clean.json",
  "captions": { "enabled": true, "maxWords": 4, "suppress": [[a,b]] },
  "face": { "x0": 980, "y0": 150, "x1": 1200, "y1": 620 },     // optional; measured default
  "beats": [
    { "id": "b01", "start": 0, "end": 8.6, "visual": "aroll" },
    { "id": "b03", "start": 22, "end": 29, "visual": "broll",
      "broll": [ { "clip": "dji-20260805095809-0023-d", "in": 20, "dur": 6.5, "fit": "cover", "treatment": "full" } ] },
    { "id": "b05", "start": 33, "end": 46, "visual": "card",
      "card": { "type": "process", "eyebrow": "HARDWARE PHASES", "steps": ["EVT","DVT","PVT"], "labels": ["Engineering","Design","Production"], "active": 0, "theme": "night", "side": "left" } },
    { "id": "b09", "start": 60, "end": 66, "visual": "broll+card", "broll": [...], "card": { "type": "bignum", "value": 50, "label": "units built", "at": 61, "dur": 5 } }
  ]
}
PANEL cards (a surface in one corner; `side` left|right, `v` top|mid|bottom, `width`)
  lower-third {eyebrow,title,sub,wordmark}          bignum {eyebrow,value,unit,label,sub,fmt}
  process {eyebrow,steps[],labels[],active,reveal[]} checklist {eyebrow,title,items[],reveal[]}
  callout {eyebrow,text,sub}                         timeline {eyebrow,items[{when,what}],active,reveal[]}
FULL-FRAME cards (take the frame; `over:"footage"` swaps the fill for a scrim)
  statement {eyebrow,text,sub}   text splits on " / " into masked rising lines
  list {eyebrow,title,items[],reveal[],numbered}     full-frame numbered list
  compare {left:{head,big,items[]},right:{...},win}  two columns, hard seam, coral on `win`
  quote {text,attrib}                                word-stagger brighten
  endcard {title,sub,cta}
NO-TEXT graphics (drawn over the footage)
  annotate {shape:circle|underline|arrow|bracket, box:[x,y,w,h], label?, draw?}
  cells {count,filled,label,eyebrow}                 pixel cells lighting up
MOTION  enter/exit: rise | plant | fade | wipe | dither   (defaults per type)
B-ROLL  {clip,in,at,dur|until,fit:cover|pillar,treatment:full|inset,side,enter:"wipe",from}
RHYTHM  defaults <- project.style.rhythm <- plan.rhythm <- per-beat fields
        { minFull:3.2, minInset:2.2, maxBare:20, maxUnaugmented:0.5, ... }
        bin/style.mjs sets project.style; the report then measures the cut
        against that cadence. Shots below the floor are extended into
        available room, or dropped.
        The build reports coverage, shot lengths, card-type mix and the longest
        bare stretch, and warns when a rule is broken.
*/
