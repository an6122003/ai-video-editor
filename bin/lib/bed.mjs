// The music bed, defined once.
//
// mix-audio.mjs builds it and verify-mix.mjs measures it. If the two ever
// described the bed differently the verification would be measuring a mix
// nobody shipped, so both import this.
//
// Why this is more than "-stream_loop -1": a library track fades out, and often
// over far longer than a crossfade would cover. `Cosy - Dyalla` runs 141s under
// a 200s edit and its outro starts at 129s — by 138s it is 32dB below its own
// body. Butt-joined, that drops the bed to nothing at 2:21; crossfaded over 6s,
// it still leaves a ten-second trough either side of the seam, because both
// copies are already fading inside the overlap. So: find the part of the track
// that is actually playing, loop THAT, and crossfade the joins.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const ffprobeDur = async (file) =>
  Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).stdout.trim());

// Mean RMS of one window, in dB. astats over a segment, not a per-frame profile:
// a handful of short reads is quicker than parsing frame metadata and the
// resolution we need is seconds, not frames.
const rms = async (file, ss, t) => {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(ss), "-t", String(t),
    "-i", file, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const m = stderr.match(/RMS level dB:\s*(-?[\d.]+|-?inf)/);
  return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : NaN;
};

// The stretch of the track that is at playing level: the outro fade trimmed off
// the end, and a genuinely silent lead-in off the front (a sparse intro is
// music and is kept — only silence is cut).
export async function usableBody(file, { probe = 40, win = 2, drop = 6, silence = 20 } = {}) {
  const dur = await ffprobeDur(file);
  const ref = await rms(file, 0, dur);
  if (!Number.isFinite(ref)) return { in: 0, out: dur, dur, ref: NaN, trimmed: false };

  let out = dur;
  for (let t = Math.max(0, dur - probe); t + 0.5 < dur; t += win) {
    const r = await rms(file, t, Math.min(win, dur - t));
    if (Number.isFinite(r) && r >= ref - drop) out = Math.min(dur, t + win);
  }
  let start = 0;
  for (let t = 0; t + win <= Math.min(probe, dur); t += win) {
    const r = await rms(file, t, win);
    if (Number.isFinite(r) && r < ref - silence) start = t + win;
    else break;
  }
  // A detector that decided almost nothing is usable is wrong about the track,
  // not right about the music. Fall back to the whole thing.
  if (out - start < Math.min(20, dur * 0.4)) return { in: 0, out: dur, dur, ref, trimmed: false };
  return { in: start, out, dur, ref, trimmed: start > 0.05 || out < dur - 0.05 };
}

// How many copies of `body` seconds are needed to cover `dur` when each seam
// eats `xfade`.
export const copiesFor = (dur, bodyDur, xfade) => {
  const gain = Math.max(1, bodyDur - xfade);
  return Math.max(1, Math.ceil(Math.max(0, dur - bodyDur) / gain) + 1);
};

// Filter-graph lines producing [bed]: each copy trimmed to the body, joined with
// crossfades, cut to length, topped and tailed, and set to the bed level.
//   firstInput  ffmpeg input index of the first music copy
//   copies      how many copies were added as inputs
//   body        { in, out } from usableBody(), or omit for the whole track
export function bedGraph({ firstInput, copies, dur, musicDb, xfade = 6, body = null, label = "bed" }) {
  const g = [];
  const trim = body ? `atrim=${body.in.toFixed(3)}:${body.out.toFixed(3)},` : "";
  for (let i = 0; i < copies; i++) {
    g.push(`[${firstInput + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim}asetpts=PTS-STARTPTS[m${i}]`);
  }
  let cur = "m0";
  for (let i = 1; i < copies; i++) {
    // qsin, not tri: two uncorrelated signals on linear amplitude ramps sum to
    // -3dB at the midpoint, which is an audible dip in the bed every seam. The
    // quarter-sine pair is the equal-power curve and holds the level across it.
    g.push(`[${cur}][m${i}]acrossfade=d=${xfade}:c1=qsin:c2=qsin[x${i}]`);
    cur = `x${i}`;
  }
  g.push(
    `[${cur}]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, dur - 3).toFixed(3)}:d=3,` +
    `volume=${musicDb}dB[${label}]`,
  );
  return g;
}

// The duck. A ratio of 8 with the bed already 16dB down held the music at
// -40 LUFS for the whole of a talking-head video: 96% of the runtime is speech,
// so with a 450ms release the compressor never let go and the bed was inaudible
// rather than "under". Default to a gentler 4:1 and set the level so the DUCKED
// bed lands where you want it; verify-mix.mjs measures which.
export const DUCK = { ratio: 4, threshold: 0.03, attack: 25, release: 500 };

export const duckGraph = (bed, sc, out, d = {}) => {
  const { ratio, threshold, attack, release } = { ...DUCK, ...d };
  return `[${bed}][${sc}]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1:level_sc=1[${out}]`;
};
