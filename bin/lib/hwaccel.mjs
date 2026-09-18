// Pick a hardware decoder that actually works on THIS machine.
//
// Every ffmpeg call in this repo used to hardcode `-hwaccel cuda`, because it
// was written on a Windows box with an NVIDIA card. On a Mac that is not a
// slower path, it is a hard failure: ffmpeg reports "Device creation failed:
// -12", then "No device available for decoder", and exits 244 without
// decoding a frame. `bin/aroll-clean.mjs` had a `--no-hwaccel` escape hatch,
// undocumented, and the other three call sites had nothing.
//
// THERE IS NO METAL HWACCEL IN FFMPEG, and asking for one is the wrong shape
// of question. Metal is a GPU compute and graphics API; video decode and
// encode on Apple silicon run on a separate fixed-function media engine, and
// ffmpeg reaches that engine through VideoToolbox. VideoToolbox is the macOS
// counterpart to CUDA here — same job, same place in the command line.
//
// PROBE, DO NOT ASSUME THE PLATFORM. `process.platform === "darwin"` only
// tells you which decoder to hope for, never whether it is there: an ffmpeg
// from a minimal build can lack VideoToolbox, a Linux box may have none of
// these, and a Windows ffmpeg built without the NVIDIA headers reports no cuda
// at all while the machine has the card. So ask ffmpeg what it lists, then
// prove it on half a second of the real file — a device can be listed and
// still fail to allocate, which is the failure that started this.
//
// The probe costs one short ffmpeg run, once per process, and only on the
// first call. A decode that falls back to software is slower; a decode that
// dies takes the whole command with it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Ordered by preference per platform. The first one that is both listed and
// provable wins; anything not listed here is never tried.
const ORDER = process.platform === "darwin"
  ? ["videotoolbox"]
  : process.platform === "win32"
    ? ["cuda", "d3d11va", "qsv"]
    : ["cuda", "vaapi", "qsv"];

let cached;   // undefined = not probed yet · null = probed, nothing usable

/**
 * @param sample  a real media file to prove the decoder on. Omit and a listed
 *                decoder is taken on trust — cheaper, and wrong more often.
 * @param opts.disabled  true short-circuits to null (wire your --no-hwaccel here)
 * @param opts.only      force one name, skipping the preference order
 * @returns the hwaccel name, or null for software decode
 */
export async function detectHwaccel(sample, { disabled = false, only = null } = {}) {
  if (disabled) return null;
  if (cached !== undefined && !only) return cached;

  let listed = "";
  try {
    const { stdout, stderr } = await run("ffmpeg", ["-hide_banner", "-hwaccels"]);
    listed = stdout + stderr;
  } catch {
    return only ? null : (cached = null);   // no ffmpeg at all — the caller's problem, not ours
  }

  for (const name of only ? [only] : ORDER) {
    // Match a whole line: "cuda" is a substring of nothing here today, but
    // a loose /cuda/ test would also match a future "cuda_something".
    if (!new RegExp(`^\\s*${name}\\s*$`, "m").test(listed)) continue;
    if (!sample) return only ? name : (cached = name);
    try {
      await run("ffmpeg", ["-v", "error", "-hwaccel", name, "-t", "0.5", "-i", sample, "-f", "null", "-"]);
      return only ? name : (cached = name);
    } catch {
      // Listed but it cannot allocate a device, or cannot decode this codec.
      // Keep looking; software decode is the floor and it always works.
    }
  }
  return only ? null : (cached = null);
}

/** The same thing, ready to spread into an argv: [] or ["-hwaccel", name]. */
export async function hwaccelArgs(sample, opts) {
  const name = await detectHwaccel(sample, opts);
  return name ? ["-hwaccel", name] : [];
}
