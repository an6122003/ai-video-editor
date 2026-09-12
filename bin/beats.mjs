#!/usr/bin/env node
// Cuts a word-level transcript into editing beats — the units the director
// decides on (A-roll / B-roll / card). A beat is a sentence-ish stretch of
// 3–12 seconds: it breaks on terminal punctuation or a pause, and splits a
// run-on at the nearest clause boundary once it passes the ceiling.
//
//   node bin/beats.mjs [work/transcript.clean.json] [--min 3] [--max 12]
//
// Writes work/beats.json and prints the list, one line per beat, so the plan
// can be written against real timestamps rather than guesses.
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const SRC = args.find((a) => !a.startsWith("--") && !/^\d/.test(a)) ?? "work/transcript.clean.json";
const MIN = flag("--min", 3), MAX = flag("--max", 12);

const words = JSON.parse(await readFile(SRC, "utf8"));
const beats = [];
let cur = [];
const flush = () => {
  if (!cur.length) return;
  beats.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
  cur = [];
};
for (let i = 0; i < words.length; i++) {
  const w = words[i], next = words[i + 1];
  cur.push(w);
  const span = w.end - cur[0].start;
  const gap = next ? next.start - w.end : Infinity;
  const terminal = /[.!?]$/.test(w.text);
  const clause = /[,;:]$/.test(w.text) || /^(so|and|but|because|which|then)$/i.test(next?.text ?? "");
  if (!next) { flush(); break; }
  if (terminal && span >= MIN) flush();
  else if (gap >= 0.6 && span >= MIN) flush();
  else if (span >= MAX && clause) flush();
  else if (span >= MAX * 1.4) flush(); // hard ceiling — never let a beat run away
}

// Beats under MIN merge forward into the next one: a two-word "All right." is
// not a decision point on its own.
const merged = [];
for (const b of beats) {
  const last = merged[merged.length - 1];
  if (last && (b.end - b.start) < MIN && (b.end - last.start) <= MAX * 1.4) {
    last.end = b.end; last.words.push(...b.words);
  } else merged.push(b);
}

const out = merged.map((b, i) => ({
  id: `b${String(i + 1).padStart(2, "0")}`,
  start: +b.start.toFixed(2),
  end: +b.end.toFixed(2),
  dur: +(b.end - b.start).toFixed(2),
  text: b.words.map((w) => w.text).join(" "),
}));
await writeFile("work/beats.json", JSON.stringify(out, null, 1));

const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
for (const b of out) console.log(`${b.id} ${mmss(b.start)} ${String(b.start.toFixed(1)).padStart(6)}-${String(b.end.toFixed(1)).padEnd(6)} ${String(b.dur.toFixed(1)).padStart(4)}s  ${b.text}`);
console.log(`\n${out.length} beats over ${out[out.length - 1].end.toFixed(1)}s -> work/beats.json`);
