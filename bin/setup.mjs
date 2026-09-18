#!/usr/bin/env node
// One command that makes this repository ready to edit a video.
//
//   node bin/setup.mjs            (or: npm run setup)
//   node bin/setup.mjs --check    report only, change nothing
//
// It installs the npm packages, finds a usable Python, builds the venv and
// installs the transcription dependencies into it — then proves the thing
// actually works by importing it, rather than assuming a successful pip run
// means a working toolchain.
//
// Deliberately written against Node built-ins only, because it has to run
// BEFORE `npm install` has put anything in node_modules.
//
// Safe to re-run: every step checks whether it is already done. That matters
// more than it sounds, because the most common way somebody uses this is to
// run it again after fixing whatever it told them was missing.
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");
const WIN = process.platform === "win32";

const ok = (m, d = "") => console.log(`  ✓ ${m}${d ? `  ${d}` : ""}`);
const bad = (m, d = "") => console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`);
const step = (m) => console.log(`\n${m}`);

// npm on Windows is a .cmd, and there is no good way to spawn it: directly
// throws EINVAL on Node 20+, and passing an args ARRAY with shell:true earns a
// deprecation warning. So npm runs as a single shell string — it takes no path
// arguments here, so there is nothing to quote — while everything else is a
// real executable spawned directly with its args, which is what keeps a path
// like "C:\Program Files\..." safe.
const sh = (cmd, args, opts = {}) => new Promise((res) => {
  const p = cmd === "npm"
    ? spawn([cmd, ...args].join(" "), { cwd: REPO, stdio: "inherit", shell: true, ...opts })
    : spawn(cmd, args, { cwd: REPO, stdio: "inherit", ...opts });
  p.on("close", (code) => res(code === 0));
  p.on("error", () => res(false));
});

const version = async (cmd, args = ["--version"]) => {
  try {
    const { stdout, stderr } = await run(cmd, args);
    return (stdout + stderr).split("\n")[0].trim();
  } catch { return null; }
};

const problems = [];

// ---- what the machine already has ---------------------------------------
step("Checking what you have");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok("node", process.version);
else { bad("node", `${process.version} is too old — this needs Node 20 or newer`); problems.push("node"); }

const ff = await version("ffmpeg", ["-version"]);
if (ff) ok("ffmpeg", ff.replace(/^ffmpeg version /, "").slice(0, 34));
else {
  bad("ffmpeg", WIN ? "install it: winget install Gyan.FFmpeg   (then reopen the terminal)"
                    : "install it: brew install ffmpeg   (macOS)  /  apt install ffmpeg  (Linux)");
  problems.push("ffmpeg");
}
if (ff && !(await version("ffprobe", ["-version"]))) {
  bad("ffprobe", "ffmpeg is installed but ffprobe is not on PATH — the install is partial");
  problems.push("ffprobe");
} else if (ff) ok("ffprobe");

// Any of these will do. 3.13 and 3.12 are both tested; the venv module is all
// that is actually required of it.
const PY_CANDIDATES = WIN
  ? [["py", ["-3.13"]], ["py", ["-3.12"]], ["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3.13", []], ["python3.12", []], ["python3", []], ["python", []]];

let python = null;
for (const [cmd, pre] of PY_CANDIDATES) {
  const v = await version(cmd, [...pre, "--version"]);
  if (!v) continue;
  const m = /Python (\d+)\.(\d+)/.exec(v);
  if (!m) continue;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  if (maj === 3 && min >= 10) { python = { cmd, pre, v }; break; }
}
if (python) ok("python", `${python.v} (${[python.cmd, ...python.pre].join(" ")})`);
else {
  bad("python", "no Python 3.10+ found. Install 3.12 or 3.13 from python.org, then run this again.");
  problems.push("python");
}

if (problems.length) {
  console.log(`\n${problems.length} thing${problems.length === 1 ? "" : "s"} to install first. Nothing has been changed.`);
  console.log("Install them, reopen your terminal, and run this again.");
  process.exit(1);
}

// ---- the venv's interpreter, wherever this platform puts it --------------
const venvPy = () => [join(REPO, ".venv", "Scripts", "python.exe"), join(REPO, ".venv", "bin", "python")]
  .find((p) => existsSync(p)) ?? null;

if (CHECK_ONLY) {
  step("Checking what is installed");
  existsSync(join(REPO, "node_modules")) ? ok("npm packages") : bad("npm packages", "not installed");
  const vp = venvPy();
  if (!vp) bad("python venv", "not created");
  else {
    ok("python venv", (await version(vp)) ?? "");
    try { await run(vp, ["-c", "import faster_whisper"]); ok("transcription deps"); }
    catch { bad("transcription deps", "not installed into the venv"); }
  }
  existsSync(join(REPO, ".mcp.json")) ? ok("B-roll library configured") : bad("B-roll library", "not configured (optional)");
  process.exit(0);
}

// ---- npm ------------------------------------------------------------------
step("Installing npm packages");
if (existsSync(join(REPO, "node_modules", "hyperframes"))) {
  ok("already installed");
} else if (!(await sh("npm", ["install", "--no-audit", "--no-fund"]))) {
  bad("npm install failed", "scroll up for the reason");
  process.exit(1);
} else ok("done");

// ---- the venv -------------------------------------------------------------
step("Setting up Python");
if (venvPy()) {
  ok("venv exists", (await version(venvPy())) ?? "");
} else {
  console.log(`  creating .venv with ${[python.cmd, ...python.pre].join(" ")} ...`);
  if (!(await sh(python.cmd, [...python.pre, "-m", "venv", ".venv"])) || !venvPy()) {
    bad("could not create the venv",
        WIN ? "if you installed Python from the Microsoft Store, install it from python.org instead"
            : "you may need the venv module: apt install python3-venv");
    process.exit(1);
  }
  ok("venv created");
}

const PY = venvPy();

// A successful pip run is not proof of a working toolchain — a wheel can
// install and still fail to import. So this imports what transcribe.py imports.
let deps = false;
try { await run(PY, ["-c", "import faster_whisper"]); deps = true; } catch { /* install below */ }

if (deps) {
  ok("transcription dependencies already installed");
} else {
  console.log("  installing transcription dependencies (a minute or so) ...");
  await sh(PY, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  if (!(await sh(PY, ["-m", "pip", "install", "--quiet", "-r", "requirements.txt"]))) {
    bad("pip install failed", "scroll up for the reason");
    process.exit(1);
  }
  try {
    await run(PY, ["-c", "import faster_whisper, ctranslate2"]);
    ok("installed and imports cleanly");
  } catch (e) {
    bad("installed but will not import", String(e.message).split("\n")[0]);
    process.exit(1);
  }
}

// ---- the shared B-roll library (optional) ---------------------------------
step("B-roll library");
if (existsSync(join(REPO, ".mcp.json"))) {
  ok("configured", "an agent opened here can search the library over MCP");
} else {
  console.log("  Not configured. This is optional, and it is the single biggest time-saver:");
  console.log("  an agent can search every described shot without downloading any video.");
  console.log("");
  console.log("    1. open  https://cyrusstudio.space/broll/");
  console.log("    2. Connect an agent  ->  Copy agent brief");
  console.log("    3. paste that to your agent, or save it as .mcp.json here");
  console.log("");
  console.log("  You also need the studio password for pulling footage:");
  console.log(WIN ? "    $env:BROLL_PASSWORD='...'" : "    export BROLL_PASSWORD='...'");
}

// ---- done -----------------------------------------------------------------
const rel = PY.replace(REPO, ".").replace(/\\/g, "/");
console.log(`
Ready.

Start a video:

  node bin/new-project.mjs "path/to/your-recording.mp4" --name my-episode

That checks the recording, makes projects/my-episode/ and prints what to run
next. Or just tell your agent to edit your video — AGENTS.md tells it the rest.

Your Python is ${rel}`);
