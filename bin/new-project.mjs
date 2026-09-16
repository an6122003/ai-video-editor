#!/usr/bin/env node
// Start a project from a video file. This is step one of everything.
//
//   node bin/new-project.mjs "path/to/recording.mp4"
//   node bin/new-project.mjs "recording.mp4" --name why-no-touchscreen --broll "path/to/footage/"
//
// Every project in this repo used to be assembled by hand, which is fine for
// whoever built the pipeline and useless for anybody else. Someone who has just
// cloned this and wants to edit a video should not have to learn the folder
// layout, guess a composition size, or hand-write JSON before the first command
// does anything.
//
// It also runs the toolchain check first, because "ffmpeg is not installed" is
// a much better thing to be told now than forty minutes into a transcribe.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const SRC = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);

if (!SRC || has("--help")) {
  console.log(`Start a project from a video file.

  node bin/new-project.mjs "path/to/recording.mp4" [options]

  --name <slug>       folder name under projects/  (default: from the filename)
  --broll <dir>       a folder of B-roll to index later
  --brand <name>      design system to use          (default: nowa)
  --language <code>   spoken language               (default: en)
  --vertical          make 9:16 the master instead of 16:9

Then follow the commands it prints.`);
  process.exit(SRC ? 0 : 1);
}

// ---- 1. is the machine able to do this at all? --------------------------
// Checked before anything is created, so a missing tool is a message rather
// than a half-made project and a confusing failure three commands later.
const checks = [];
const check = async (label, cmd, cmdArgs, hint) => {
  try {
    const { stdout, stderr } = await run(cmd, cmdArgs);
    const v = (stdout + stderr).split("\n")[0].trim().slice(0, 60);
    checks.push({ ok: true, label, v });
  } catch {
    checks.push({ ok: false, label, hint });
  }
};

await check("node", process.execPath, ["--version"], "install Node 20 or newer");
await check("ffmpeg", "ffmpeg", ["-version"], "install ffmpeg 6+ and put it on your PATH");
await check("ffprobe", "ffprobe", ["-version"], "comes with ffmpeg — if one works and not the other, your PATH is partial");

// The venv is how transcribe.py runs. Its interpreter lives in a different
// place on Windows, which is the single most common thing to get wrong.
const venvPy = [join(REPO, ".venv", "Scripts", "python.exe"), join(REPO, ".venv", "bin", "python")]
  .find((p) => existsSync(p));
if (venvPy) {
  try {
    await run(venvPy, ["-c", "import faster_whisper"]);
    const { stdout } = await run(venvPy, ["--version"]);
    checks.push({ ok: true, label: "python venv", v: stdout.trim() });
  } catch {
    checks.push({ ok: false, label: "python venv",
      hint: `dependencies are missing — run: ${venvPy} -m pip install -r requirements.txt` });
  }
} else {
  checks.push({ ok: false, label: "python venv",
    hint: "not created yet — run: python -m venv .venv  then install requirements.txt into it" });
}

if (!existsSync(join(REPO, "node_modules"))) {
  checks.push({ ok: false, label: "npm packages", hint: "run: npm install" });
} else {
  checks.push({ ok: true, label: "npm packages", v: "installed" });
}

console.log("Checking the toolchain\n");
for (const c of checks) {
  console.log(c.ok ? `  ok    ${c.label.padEnd(13)} ${c.v ?? ""}` : `  MISSING ${c.label.padEnd(11)} ${c.hint}`);
}
const broken = checks.filter((c) => !c.ok);
if (broken.length) {
  console.log(`\n${broken.length} thing${broken.length === 1 ? "" : "s"} to fix first. Nothing has been created.`);
  process.exit(1);
}

// ---- 2. look at the video ------------------------------------------------
const srcPath = resolve(SRC);
if (!existsSync(srcPath)) {
  console.error(`\nNo such file: ${srcPath}`);
  process.exit(1);
}

const probe = async (path) => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate", "-show_entries", "format=duration",
    "-of", "json", path]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] ?? {};
  const [n, d] = String(s.r_frame_rate ?? "30/1").split("/").map(Number);
  return { width: s.width ?? 1920, height: s.height ?? 1080,
           fps: Math.round((n / (d || 1)) * 100) / 100, duration: Number(j.format?.duration ?? 0) };
};

let info;
try { info = await probe(srcPath); }
catch (e) { console.error(`\nffprobe could not read that file: ${String(e.message).split("\n")[0]}`); process.exit(1); }

const slug = (flag("--name", null) ?? basename(srcPath, extname(srcPath)))
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "episode";
const dir = join(REPO, "projects", slug);
if (existsSync(dir)) {
  console.error(`\nprojects/${slug} already exists. Pass --name <something-else>.`);
  process.exit(1);
}

const vertical = has("--vertical");
const comp = vertical ? { width: 1080, height: 1920, fps: 30 } : { width: 1920, height: 1080, fps: 30 };

// ---- 3. make it ----------------------------------------------------------
for (const sub of ["work", "broll", "out", "media"]) await mkdir(join(dir, sub), { recursive: true });

const project = {
  name: slug,
  brand: flag("--brand", "nowa"),
  language: flag("--language", "en"),
  source: {
    aroll: srcPath.replace(/\\/g, "/"),
    ...(flag("--broll", null) ? { broll: resolve(flag("--broll")).replace(/\\/g, "/") } : {}),
  },
  composition: comp,
  deliverables: vertical ? ["vertical_9x16"] : ["youtube_16x9", "vertical_9x16", "shorts_9x16_under_3min"],
  notes: `Source is ${info.width}x${info.height} at ${info.fps}fps, ${Math.round(info.duration)}s.` +
    (info.height < comp.height
      ? ` It is SMALLER than the ${comp.width}x${comp.height} composition, so the speaker will be upscaled ` +
        `${(comp.height / info.height).toFixed(2)}x — cards and B-roll carry the sharpness.`
      : ""),
};
await writeFile(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n");

const py = venvPy.replace(REPO + "\\", "../../").replace(REPO + "/", "../../").replace(/\\/g, "/");

console.log(`\nMade projects/${slug}`);
console.log(`  source     ${info.width}x${info.height} @ ${info.fps}fps, ${Math.round(info.duration)}s`);
console.log(`  output     ${comp.width}x${comp.height} @ ${comp.fps}fps`);
if (info.height < comp.height)
  console.log(`  note       the speaker will be upscaled ${(comp.height / info.height).toFixed(2)}x`);

console.log(`\nNext, from projects/${slug}:\n`);
console.log(`  cd projects/${slug}`);
console.log(`  node ../../bin/fetch-fonts.mjs fonts --brand ${project.brand}`);
console.log(`  ${py} ../../bin/transcribe.py "${project.source.aroll}" --out work --language ${project.language}`);
console.log(`  node ../../bin/aroll-clean.mjs            # proposes cuts — review work/cuts.json`);
console.log(`  node ../../bin/aroll-clean.mjs --apply`);
console.log(`  node ../../bin/beats.mjs`);
console.log(`  node ../../bin/treatment.mjs             # what each beat wants`);

if (project.source.broll) {
  console.log(`\nTo index your own B-roll:`);
  console.log(`  node ../../bin/broll-index.mjs "${project.source.broll}" --out broll`);
} else {
  console.log(`\nFor footage, either index your own:`);
  console.log(`  node ../../bin/broll-index.mjs "<folder of clips>" --out broll`);
  console.log(`or pull a published library (3 MB, searchable, no video):`);
  console.log(`  BROLL_PASSWORD=... node ../../bin/broll-pull.mjs --remote <library url>`);
}

console.log(`\nThen write edit-plan.json. Read ../nowa-no-touchscreen/edit-plan.json first —`);
console.log(`it is a finished one, and PIPELINE.md explains every field.`);
