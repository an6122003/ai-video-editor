#!/usr/bin/env node
// The step between the script and the plan: go through every beat and say what
// it wants — a PICTURE, a GRAPHIC, our own FOOTAGE, or nothing at all — and for
// the picture beats, what to go and search for.
//
//   node bin/treatment.mjs                       # propose -> work/treatment.json
//   node bin/treatment.mjs --queries             # just the search list, one per line
//   node bin/treatment.mjs --apply-search --n 12 # run every search it proposes
//
// Why this exists: without it the sourcing is ad hoc. You reach for one image
// for the one subject you happen to think of, and a three-minute video ends up
// with four pictures. The classification has to come from the script, beat by
// beat, BEFORE any searching happens.
//
// How each beat is classified, in order:
//   PICTURE  the beat names something we cannot shoot — someone else's product,
//            or a thing the B-roll library has no clip of. These are the
//            searches.
//   FOOTAGE  the library already shows the thing being talked about, so a
//            picture would be redundant.
//   GRAPHIC  the beat carries a figure, a sequence, a contrast or a claim — a
//            shape, not a thing. A card, not a photograph.
//   NONE     he is addressing the viewer, or there is nothing to show and no
//            shape to draw. Leave it on his face.
//
// It proposes; it cannot know that "the dad's face" is a joke rather than a
// request for a stock photo of a man. Every row carries the evidence it used,
// so the list is meant to be read and corrected.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = flag("--out", "work/treatment.json");
const N = Number(flag("--n", 12));
// Names that belong to US: the brand, the speaker, anyone on the team. Without
// this the classifier proposes searching Google for "daniel toy", because a
// capitalised word it does not recognise looks exactly like someone else's
// product. --own "Daniel,Permill" or project.json { "ownNames": [...] }.
const project = existsSync("project.json") ? JSON.parse(await readFile("project.json", "utf8")) : {};
const OWN = new Set([...(project.ownNames ?? []), ...String(flag("--own", "")).split(","), project.name ?? "", "Nowa"]
  .map((n) => String(n).toLowerCase().trim()).filter(Boolean));

const beatsRaw = JSON.parse(await readFile(flag("--beats", "work/beats.json"), "utf8"));
const beats = Array.isArray(beatsRaw) ? beatsRaw : beatsRaw.beats;
const index = existsSync("broll/index.json") ? JSON.parse(await readFile("broll/index.json", "utf8")) : { clips: [] };

const STOP = new Set(("the a an and or but of to in on at for with from by is are was were be been it its this that these those " +
  "i you he she we they me him her us them my your his our their as if so then than there here what which who whom whose when " +
  "where why how all any both each few more most other some such no nor not only own same too very can will just dont should now " +
  "about into over after before between out up down off again once really thing things get got make made like know think " +
  "going go went come came want need see look one two three because also actually kind sort lot bit").split(" "));
const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/)
  .map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 2 && !STOP.has(w));

// THINGS: words that name something you could point a camera at. The whole
// classification turns on this, so it is an explicit list rather than a guess.
// Matching on any shared word made "through", "past", "fun" and "second" into
// evidence that the footage covered a beat, and every beat came back FOOTAGE.
const THINGS = new Set(("screen touchscreen display glass button buttons key keys keyboard wheel scroller trackwheel trackball " +
  "dial knob switch remote phone smartphone blackberry iphone device unit toy console gameboy tamagotchi walkman ipod " +
  "album photograph photo picture book magazine newspaper typewriter camera film arcade joystick speaker microphone mic " +
  "case shell board pcb tray foam factory line bench worker workers hand hands finger fingers cable earphone headphone " +
  "jack sticker label box packaging bumper charger led motor").split(" "));

const footageVocab = new Map();               // thing -> [clip ids]
for (const c of index.clips ?? []) {
  for (const s of c.segments ?? []) {
    const said = new Set(words(`${s.action ?? ""} ${(s.tags ?? []).join(" ")} ${s.subject ?? ""}`));
    for (const w of said) if (THINGS.has(w)) footageVocab.set(w, [...new Set([...(footageVocab.get(w) ?? []), c.id])]);
  }
}

// A GRAPHIC beat has a shape: a figure, an enumeration, a contrast, a claim.
const GRAPHIC_RE = [
  [/\b(\d+|one|two|three|four|five|six|seven|ten|hundred|thousand|million|percent)\b/i, "a figure"],
  [/\b(first|second|third|then|next|finally|step)\b/i, "a sequence"],
  [/\b(versus|instead of|rather than|whereas|compared|more than|less than)\b/i, "a contrast"],
  [/\b(because|the reason|so that|which means|the point is|essentially)\b/i, "a claim"],
  [/\b(and also|as well as|another)\b/i, "an enumeration"],
];
const ADDRESS_RE = /\b(hello|hi there|today we|thank you|see you|welcome|subscribe|my name|in this video)\b/i;
// A brand or product name is almost always worth a picture, and it is the
// qualifier that makes a search specific: "wheel" returns steering wheels,
// "blackberry wheel" returns the thing he is talking about.
const NOT_A_NAME = new Set(("Well And But So The This That When What Why How Then Now Because Also My Our Your You They Them " +
  "One Two For With There Here Its It If As At In On To We He She Him Her Us A An Or Nor Not Only Just Very Really Actually " +
  "Maybe Like Every Each Some Any All Both More Most Other Such No Same Too Can Will Should Would Could Does Did Have Has " +
  "Had Been Being Am Are Was Were Be Let Okay Yeah").split(" "));

const rows = beats.map((b) => {
  const said = [...new Set(words(b.text))];
  const things = said.filter((w) => THINGS.has(w));
  const shot = things.filter((w) => footageVocab.has(w));          // we filmed this
  const unshot = things.filter((w) => !footageVocab.has(w));       // we did not
  const clips = [...new Set(shot.flatMap((w) => footageVocab.get(w)))];
  const graphic = GRAPHIC_RE.filter(([re]) => re.test(b.text)).map(([, why]) => why);
  const names = [...new Set((b.text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !NOT_A_NAME.has(w)))];
  const foreign = names.filter((n) => !OWN.has(n.toLowerCase()));

  let treatment, why;
  if (foreign.length) {
    treatment = "picture";
    why = `names ${foreign.join(", ")} — someone else's thing, and we have no footage of it`;
  } else if (unshot.length) {
    treatment = "picture";
    why = `says ${unshot.join(", ")} and the library has no clip of that`;
  } else if (ADDRESS_RE.test(b.text) && !things.length) {
    treatment = "none"; why = "he is addressing the viewer";
  } else if (shot.length) {
    treatment = "footage";
    why = `${clips.length} clip${clips.length === 1 ? "" : "s"} show ${shot.slice(0, 4).join(", ")}`;
  } else if (graphic.length) {
    treatment = "graphic"; why = graphic.join(" + ");
  } else { treatment = "none"; why = "nothing to show and no shape to draw"; }

  // A search is only as good as its qualifier. Rather than the bare noun, take
  // the phrase it sits in — the content words immediately before it in what he
  // actually said. "album" is a search for record sleeves; "actual photo album"
  // is not. A query that still comes out as one word is flagged for a human.
  const toks = b.text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const phraseFor = (thing) => {
    const at = toks.findIndex((t) => t.replace(/'s$/, "") === thing);
    if (at < 0) return thing;
    const before = [];
    for (let i = at - 1; i >= 0 && before.length < 2; i--) {
      const t = toks[i];
      if (STOP.has(t) || t.length < 3) { if (before.length) break; else continue; }
      before.unshift(t);
    }
    return [...before, thing].join(" ");
  };
  const dedupe = (str) => [...new Set(str.split(" "))].join(" ");
  const q = treatment !== "picture" ? []
    : (foreign.length
        ? foreign.flatMap((n) => (things.length
            ? things.slice(0, 2).map((t) => dedupe(`${n} ${phraseFor(t)}`.toLowerCase()))
            : [n.toLowerCase()]))
        : unshot.slice(0, 2).map((t) => dedupe(phraseFor(t))));

  return { id: b.id, start: +b.start.toFixed(2), end: +b.end.toFixed(2), dur: +b.dur.toFixed(1),
    treatment, why, queries: [...new Set(q)].slice(0, 3), clips: clips.slice(0, 4), text: b.text };
});

await writeFile(OUT, JSON.stringify(rows, null, 2));

const allQueries = [...new Set(rows.flatMap((r) => r.queries))];
if (has("--queries")) { console.log(allQueries.join("\n")); process.exit(0); }

const tally = {}, secs = {};
for (const r of rows) { tally[r.treatment] = (tally[r.treatment] ?? 0) + 1; secs[r.treatment] = (secs[r.treatment] ?? 0) + r.dur; }
console.log(`${rows.length} beats -> ${OUT}\n`);
for (const r of rows) {
  const tag = { picture: "PICTURE", graphic: "GRAPHIC", footage: "FOOTAGE", none: "—      " }[r.treatment];
  console.log(`${r.id}  ${String(r.start).padStart(6)}s ${String(r.dur).padStart(5)}s  ${tag}  ${r.why}`);
  if (r.queries.length) console.log(`${" ".repeat(24)}search: ${r.queries.join("  |  ")}`);
}
console.log("");
for (const k of ["picture", "graphic", "footage", "none"])
  if (tally[k]) console.log(`  ${k.padEnd(8)} ${String(tally[k]).padStart(2)} beats, ${secs[k].toFixed(0)}s`);
console.log(`\n${allQueries.length} search${allQueries.length === 1 ? "" : "es"} to run:`);
for (const q of allQueries)
  console.log(`  ${q}${q.split(" ").length < 2 ? "   <- one word: qualify it by hand or it returns junk" : ""}`);

if (has("--apply-search")) {
  console.log("");
  for (const q of allQueries) {
    process.stdout.write(`searching "${q}" ... `);
    try {
      const { stdout } = await run("node", [join(REPO, "bin/image-search.mjs"), q, "--source", "serper", "--n", String(N)],
        { maxBuffer: 1 << 26 });
      const found = /serper: (\d+) found/.exec(stdout);
      const saved = /(\d+) candidates ->/.exec(stdout);
      console.log(`${found ? found[1] : "?"} found, ${saved ? saved[1] : 0} downloaded`);
    } catch (e) { console.log(`failed: ${String(e.message).split("\n")[0]}`); }
  }
  console.log(`\nNow open media/review.html, approve what fits, and reference it from a beat.`);
}
