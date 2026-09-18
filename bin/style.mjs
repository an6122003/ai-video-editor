#!/usr/bin/env node
// Choose how the edit should FEEL, before anyone writes a plan.
//
//   node bin/style.mjs                          show the current style and the presets
//   node bin/style.mjs --ask                    interactive — ask the three questions
//   node bin/style.mjs --style product-discussion
//   node bin/style.mjs --style yapping --broll-every 8 --broll-hold 2.6
//
// Three questions decide most of a video's texture, and they are the person's
// to answer, not the editor's:
//
//   1. what kind of video is this      (yapping / product discussion / ...)
//   2. how often should it cut away    (seconds of talking between cutaways)
//   3. how long is each cutaway        (seconds on the B-roll)
//
// Everything else follows. The answers land in project.json under `style`, and
// build-edit.mjs folds `style.rhythm` in under `plan.rhythm`, so a style is not
// a comment — it changes which rhythm warnings fire and what the report
// measures the cut against.
//
// Precedence, loosest to tightest:  built-in defaults -> project.style.rhythm
// -> plan.rhythm -> per-beat fields. A style sets the room's temperature; a
// plan can still override any single number, and one beat can still do
// whatever that beat needs.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

// ── the presets ───────────────────────────────────────────────────────────
// Every number here is a rhythm knob build-edit.mjs already reads. The values
// differ because these are genuinely different kinds of video, not because
// variety is nice:
//
//   brollEvery  seconds of unbroken talking the style is willing to sit on
//   brollHold   how long a cutaway stays up
//   maxBare     the hard warning line for unbroken talking head
//   maxUnaug    share of runtime with neither B-roll nor card on screen
//   maxFull     share of runtime where the speaker is off screen entirely
//
// minFull stays at the repo default of 3.2s in every preset. That floor was
// not chosen for tidiness — 1–2s cutaways were watched and called "weird and
// abrupt", and the floor is what stops them coming back. A style that wants
// faster cutting gets it by cutting away MORE OFTEN, not by flashing shorter
// shots. `--broll-hold` will still take a lower number if you decide you want
// one; it warns, and then it does what you asked.
const PRESETS = {
  "yapping": {
    label: "Yapping",
    about: "Casual monologue, personality carries it. Cut often so the eye keeps getting something new.",
    brollEvery: 10, brollHold: 3.4,
    rhythm: { maxBare: 12, maxUnaugmented: 0.40, maxFullFrame: 0.20, maxStaticHold: 6 },
  },
  "product-discussion": {
    label: "Product discussion",
    about: "The product has to be SEEN. Fewer cutaways, each one long enough to read the object.",
    brollEvery: 18, brollHold: 5.0,
    rhythm: { minFull: 4.0, maxBare: 18, maxUnaugmented: 0.45, maxFullFrame: 0.30, maxStaticHold: 9 },
  },
  "explainer": {
    label: "Explainer",
    about: "Ideas first. Graphics and diagrams do the work; footage illustrates rather than leads.",
    brollEvery: 15, brollHold: 3.6,
    rhythm: { maxBare: 16, maxUnaugmented: 0.45, maxFullFrame: 0.35, maxStaticHold: 8 },
  },
  "interview": {
    label: "Interview / founder story",
    about: "Let the person breathe. Cutaways support what was said; they do not interrupt it.",
    brollEvery: 30, brollHold: 4.0,
    rhythm: { maxBare: 28, maxUnaugmented: 0.65, maxFullFrame: 0.15, maxStaticHold: 10 },
  },
};

const PROJECT = "project.json";
if (!existsSync(PROJECT)) {
  console.error("No project.json here. Run this from inside projects/<slug>/.");
  process.exit(1);
}
const project = JSON.parse(await readFile(PROJECT, "utf8"));

const show = () => {
  const s = project.style;
  console.log(s
    ? `\nCurrent style: ${s.label ?? s.name}\n` +
      `  cut away every ~${s.brollEverySec}s, holding ~${s.brollHoldSec}s\n` +
      `  rhythm ${JSON.stringify(s.rhythm ?? {})}\n`
    : "\nNo style set — the edit will use the repo defaults.\n");
  console.log("Presets:\n");
  for (const [k, p] of Object.entries(PRESETS)) {
    console.log(`  ${k.padEnd(20)} ${p.label}`);
    console.log(`  ${"".padEnd(20)} ${p.about}`);
    console.log(`  ${"".padEnd(20)} cutaway every ~${p.brollEvery}s, holding ~${p.brollHold}s\n`);
  }
};

if (!has("--ask") && !flag("--style")) {
  show();
  console.log("Pick one:  node bin/style.mjs --style <name> [--broll-every <s>] [--broll-hold <s>]");
  console.log("Or ask me: node bin/style.mjs --ask\n");
  process.exit(0);
}

// ── gather the answers ────────────────────────────────────────────────────
let name = flag("--style");
let every = flag("--broll-every") !== null ? Number(flag("--broll-every")) : null;
let hold = flag("--broll-hold") !== null ? Number(flag("--broll-hold")) : null;

if (has("--ask")) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const keys = Object.keys(PRESETS);
    console.log("\nWhat kind of video is this?\n");
    keys.forEach((k, i) => console.log(`  ${i + 1}. ${PRESETS[k].label} — ${PRESETS[k].about}`));
    const pick = (await rl.question(`\nNumber, or a name [1-${keys.length}]: `)).trim();
    name = keys[Number(pick) - 1] ?? (PRESETS[pick] ? pick : null);
    if (!name) { console.error(`\nNot one of: ${keys.join(", ")}`); process.exit(1); }
    const p = PRESETS[name];

    const a = (await rl.question(
      `\nHow many seconds of talking between cutaways? [${p.brollEvery}] `)).trim();
    if (a) every = Number(a);
    const b = (await rl.question(
      `How long should each cutaway hold, in seconds? [${p.brollHold}] `)).trim();
    if (b) hold = Number(b);
  } finally { rl.close(); }
}

const preset = PRESETS[name];
if (!preset) {
  console.error(`Unknown style "${name}". One of: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}
for (const [label, v] of [["--broll-every", every], ["--broll-hold", hold]]) {
  if (v !== null && (!Number.isFinite(v) || v <= 0)) {
    console.error(`${label} wants a positive number of seconds, got "${v}".`);
    process.exit(1);
  }
}
every ??= preset.brollEvery;
hold ??= preset.brollHold;

// ── write it ──────────────────────────────────────────────────────────────
const rhythm = { ...preset.rhythm };
// A hold shorter than the floor would be a target the builder is contractually
// obliged to ignore, so the floor follows it down — and says so, because this
// is the exact thing that was rejected on ep.01.
const FLOOR_DEFAULT = 3.2;
const floor = rhythm.minFull ?? FLOOR_DEFAULT;
if (hold < floor) {
  rhythm.minFull = hold;
  rhythm.minInset = Math.min(rhythm.minInset ?? 2.2, hold);
}
rhythm.brollEvery = every;   // read by the rhythm report's cadence check

project.style = {
  name, label: preset.label,
  brollEverySec: every,
  brollHoldSec: hold,
  rhythm,
};
await writeFile(PROJECT, JSON.stringify(project, null, 2) + "\n");

console.log(`\nStyle: ${preset.label}`);
console.log(`  cut away every ~${every}s, holding ~${hold}s`);
console.log(`  rhythm ${JSON.stringify(rhythm)}`);
if (hold < FLOOR_DEFAULT) {
  console.log(`\n  NOTE  ${hold}s is below the ${FLOOR_DEFAULT}s default floor. Cutaways of 1–2s were`);
  console.log(`        watched on ep.01 and called "weird and abrupt" — that floor is why.`);
  console.log(`        Doing it anyway because you asked; look at the render before committing to it.`);
}
console.log(`\nWritten to project.json. build-edit.mjs reads it, and the rhythm report`);
console.log(`now measures the cut against this cadence rather than the generic defaults.\n`);
console.log(`Next: write edit-plan.json (see PIPELINE.md), then  node ../../bin/build-edit.mjs\n`);
