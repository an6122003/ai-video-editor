---
name: edit-video
description: Edit a talking-head recording into a finished video with this repo's pipeline — clean the A-roll, find B-roll, build a plan, render 16:9 and 9:16, mix sound, and cut short-form clips for cross-posting. Use for "edit this video", "make a video from this recording", "add B-roll to my clip", "turn this into shorts", "cut some shorts from the long one". Walks the person through the decisions that are theirs and runs everything else itself.
---

# Editing a video in this repo

`AGENTS.md` is the full runbook and the commands live there. **This file is
about the conversation**: which steps stop and ask, and what to put in front of
the person when they do.

**Assume they are not a video editor and have not read any of it.** Run the
commands yourself. Never hand them a list of things to type. Ask only about
decisions that are genuinely theirs — and when you ask, show them the thing,
not a summary of it.

---

## The shape of it

```
setup → project → STYLE?* → transcribe → CUTS?* → beats → treatment
      → footage → plan → build → look → render → sound
      → vertical → SHORTS?*
```

`*` are the three places you stop. Everything else you just do, and report.

---

## Stop 1 · What kind of video is this

**Before writing any plan.** Three questions, and the answers change the edit:

```bash
node bin/style.mjs          # prints the presets and what each one is for
```

Show them the four presets in your own words — **yapping** (casual monologue,
cut often), **product discussion** (the object has to be on screen long enough
to read), **explainer** (graphics lead), **interview** (let them breathe) — and
ask which fits, then how often to cut away and how long each cutaway should
hold. Offer the preset's numbers as the default; most people take them.

```bash
node ../../bin/style.mjs --style product-discussion --broll-every 18 --broll-hold 5
```

If they ask for a hold under 3.2s, do it — and tell them once that 1–2s
cutaways were watched on ep.01 and called "weird and abrupt", then show them
the render. Their call, made with the reason in front of them.

Skip this stop only if they say they do not care; then say which preset you
picked and why.

## Stop 2 · The proposed cuts

`bin/aroll-clean.mjs` proposes removing false starts and repeated takes.
**Never apply without showing them.** It is their voice and their call.

Show the actual lines it wants to drop, not "12 cuts proposed". Then apply
what they agree to.

## Stop 3 · Which shorts to post

Run the finder, then **approve them one at a time, on the transcript**:

```bash
node ../../bin/shorts.mjs            # prints each candidate's FULL transcript
```

For each candidate, put the transcript in front of them and ask whether it
should be posted. One at a time — "these five look fine" is not a decision
anyone made, and a rejected one costs nothing while a bad post costs them.

What to say about each: how long it is, and honestly what the tool flagged.
`OPENS MID-THOUGHT` means it starts on a bare pronoun and will need a
different first line or a different in-point — say so rather than hiding it.

Then build only what they approved:

```bash
node ../../bin/shorts.mjs --apply --pick 2,4
node ../../bin/build-edit.mjs --plan edit-plan.short-02.json
```

`--apply` refuses to run with nothing approved and nothing picked. That is
deliberate: mass-producing six clips nobody has read is the thing this step
exists to prevent.

If the tool proposes nothing, tell them plainly — it means the video is one
continuous argument rather than a set of separable moments. That is a real
answer about their video, not a failure, and the fix is a different recording,
not a lower threshold.

---

## What you do without asking

- `npm run setup`, `bin/new-project.mjs` — no decisions in either
- transcribing, beats, treatment
- searching the B-roll library (search every category first — `search_broll`
  covers them all unless you narrow it)
- writing `edit-plan.json` — **you** write it, they do not
- building, linting, snapshotting, rendering, mixing, verifying the mix

## What you always report back

- the file, what you changed, and why
- **every rhythm warning the build printed**, including the `STYLE:` ones that
  say the edit drifted off the cadence they asked for
- anything you noticed and did not fix

A quiet problem you saw and did not mention is worse than one you missed.

---

## Traps that have actually bitten

- **Do not render to check.** Rebuild is under a second and prints a rhythm
  report; a render is minutes. Use `npx hyperframes preview build` to let them
  watch it live.
- **Verify from the encoded file, never the composition.** Every real bug here
  was invisible until someone checked the actual output.
- **Do not ship a mix `verify-mix.mjs` fails.**
- **Never pass `-hwaccel` yourself, and never "fix" a decode failure by adding
  one.** `bin/lib/hwaccel.mjs` probes it — VideoToolbox on macOS, CUDA
  elsewhere, software when neither proves out. If you are about to write
  `-hwaccel cuda` into an ffmpeg command, you are re-introducing the bug that
  killed `aroll-clean.mjs` on every Mac. There is no Metal hwaccel; VideoToolbox
  is the macOS counterpart. Report which decoder a step chose — the tools print
  it — rather than assuming the machine matches the one this repo grew up on.
- **Anchor placements to spoken phrases, never timecodes** — that is what lets
  one plan produce 16:9, 9:16 and every short without re-cutting.
- **Re-running `bin/shorts.mjs --apply` overwrites `edit-plan.short-NN.json`.**
  If they hand-edited one, rename it first.
