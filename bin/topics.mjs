#!/usr/bin/env node
// Reads transcript.json and prints a sourcing worklist: every proper noun /
// product / tool the video names, with the timestamp it is first said.
//
//   node topics.mjs                 # worklist
//   node topics.mjs --json          # machine-readable, for seeding logos.json
//
// The timestamps ARE the placement times — a mark belongs on screen when the
// thing is named, not whenever there happens to be room.
import { readFile } from "node:fs/promises";

const words = JSON.parse(await readFile("transcript.json", "utf8"));

// Terms worth an on-screen asset. Extend per video — this is a starting net,
// not a closed list. Keys are what you would search for; values are the
// spellings the ASR actually produces (Whisper mangles product names badly).
const TERMS = {
  // hardware / vendors
  GIGABYTE: ["gigabyte"],
  NVIDIA: ["nvidia"],
  "Phong Vũ": ["phong", "vũ"],
  RTX: ["5090", "4090", "rtx"],
  // models / tools
  Qwen: ["qwen", "wen"],
  BGE: ["bge"],
  "GPT-OSS": ["gpt"],
  "LM Studio": ["lm", "studio"],
  llama: ["llama", "llamacpp"],
  Vulkan: ["vulkan"],
  Ollama: ["ollama"],
  HuggingFace: ["hugging", "huggingface"],
  "Claude Code": ["claude"],
  Docker: ["docker"],
  PyTorch: ["pytorch", "torch"],
};

const hits = new Map();
for (const w of words) {
  const t = w.text.toLowerCase().replace(/[.,!?:]/g, "");
  for (const [term, pats] of Object.entries(TERMS)) {
    if (pats.some((p) => t === p || t.includes(p))) {
      if (!hits.has(term)) hits.set(term, []);
      hits.get(term).push(+w.start.toFixed(2));
    }
  }
}

// Collapse mentions inside 4s of each other — one asset per beat, not per word.
const rows = [...hits.entries()].map(([term, times]) => {
  const beats = [];
  for (const t of times.sort((a, b) => a - b)) {
    if (!beats.length || t - beats.at(-1) > 4) beats.push(t);
  }
  return { term, beats, mentions: times.length };
});
rows.sort((a, b) => a.beats[0] - b.beats[0]);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log("term".padEnd(14) + "first".padEnd(9) + "beats");
  console.log("-".repeat(52));
  for (const r of rows) {
    console.log(
      r.term.padEnd(14) + String(r.beats[0]).padEnd(9) + r.beats.join(", ") + `   (${r.mentions}x)`,
    );
  }
  console.log(
    "\nEach beat is a candidate placement. Source assets per references/MEDIA-SOURCING.md,\n" +
      "then add entries to logos.json with `at` set to the beat.",
  );
}
