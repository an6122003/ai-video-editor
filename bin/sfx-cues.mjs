#!/usr/bin/env node
// Derives the sound-effect cue list from the resolved plan, on a budget.
//
//   node bin/sfx-cues.mjs [--build build] [--out sfx-cues.json] [--min-gap 6]
//
// SFX are placed semantically, not on every animation:
//   card entrance      -> soft impact       (sfx/impact-soft.wav)
//   count-up figure    -> UI tick           (sfx/tick.wav)
//   full B-roll cut    -> whoosh            (sfx/whoosh.wav)  only when the cut opens a new beat
//   process step lit   -> click             (sfx/click.wav)
//   endcard            -> chime             (sfx/chime.wav)
// and then thinned so no two noticeable hits land within --min-gap seconds
// (ticks and clicks are quiet and exempt). The mixer (mix-audio.mjs) skips
// any cue whose file is missing, so this list can be authored before the
// sounds exist. Put the sounds in <project>/sfx/ — SIL/CC0 packs, or generate.
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BUILD = flag("--build", "build");
const OUT = flag("--out", "sfx-cues.json");
const MIN_GAP = Number(flag("--min-gap", 6));

const plan = JSON.parse(await readFile(`${BUILD}/plan.resolved.json`, "utf8"));
const cues = [];
for (const c of plan.cards) {
  if (c.type === "endcard") cues.push({ at: c.at + 0.1, file: "sfx/chime.wav", db: -10, why: `${c.beat} endcard`, loud: true });
  else cues.push({ at: c.at + 0.05, file: "sfx/impact-soft.wav", db: -12, why: `${c.beat} ${c.type} in`, loud: true });
  if (c.type === "bignum") cues.push({ at: c.at + 0.25, file: "sfx/tick.wav", db: -16, why: `${c.beat} count-up`, loud: false });
}
let lastBeat = null;
for (const e of plan.brolls) {
  if (e.treatment !== "full" || e.beat === lastBeat) { lastBeat = e.beat; continue; }
  cues.push({ at: e.at, file: "sfx/whoosh.wav", db: -14, why: `${e.beat} cut to B-roll`, loud: true });
  lastBeat = e.beat;
}
cues.sort((a, b) => a.at - b.at);

// Budget: one noticeable hit per MIN_GAP seconds; the earlier one stays.
const kept = [];
let lastLoud = -Infinity;
for (const c of cues) {
  if (c.loud) {
    if (c.at - lastLoud < MIN_GAP) continue;
    lastLoud = c.at;
  }
  kept.push(c);
}
await writeFile(OUT, JSON.stringify(kept.map(({ loud, ...c }) => ({ ...c, at: +c.at.toFixed(2) })), null, 1));
console.log(`${cues.length} candidate cues -> ${kept.length} kept (min gap ${MIN_GAP}s) -> ${OUT}`);
const by = {}; for (const c of kept) by[c.file] = (by[c.file] ?? 0) + 1;
console.log(Object.entries(by).map(([f, n]) => `${f.replace("sfx/", "")}×${n}`).join("  "));
