# AGENTS.md

The operating runbook for this repository. Whatever agent you are, read this
before doing anything. `CLAUDE.md` carries the deeper doctrine — design rules,
traps, the card kit — and points here for the process.

In Claude Code the skill at `.claude/skills/edit-video/` loads on its own when
somebody asks for a video to be edited. It covers the *conversation* — which
steps stop and ask, and what to show — and defers to this file for the
commands. The two are meant to be read together.

**Assume the person asking is not a video editor and has not read any of this.**
Run the commands yourself and report what you find. Do not hand them a list of
things to type. Ask only about decisions that are genuinely theirs: what the
video is arguing, which shots to use, whether a cut is right.

---

## 0 · Set up (once per machine)

```bash
npm run setup
```

That is the whole of it. It finds a usable Python, builds the venv, installs the
transcription dependencies and then imports them to prove they work. Safe to
re-run, and `npm run setup:check` reports without changing anything.

If it stops, it is because **ffmpeg** or **Python 3.10+** is missing, and it
prints the install command for that platform. Nothing is created until both are
there. No GPU is needed — CPU transcription runs faster than realtime.

**Never hardcode a hardware decoder.** Every ffmpeg call goes through
`bin/lib/hwaccel.mjs`, which asks ffmpeg what it has and proves it on half a
second of the real file: VideoToolbox on macOS, CUDA on Windows and Linux,
software when neither answers. There is no Metal hwaccel in ffmpeg — Metal is a
compute and graphics API, and video on Apple silicon runs on a separate media
engine that ffmpeg reaches through VideoToolbox. Writing `-hwaccel cuda` into a
command is how this repo used to die on a Mac with `Device creation failed: -12`
before decoding a frame. Platform checks are not enough either: a decoder can be
listed and still fail to allocate, which is the failure that started this.

## 1 · Make the project

This is where their video goes. **Never ask them to create folders or write
`project.json`.**

```bash
node bin/new-project.mjs "<the file they gave you>" --name <short-slug>
```

Add `--broll "<folder>"` if they have their own footage, `--vertical` if 9:16
is the master. It probes the recording, picks the composition, scaffolds
`projects/<slug>/` and prints the next commands.

**If it reports an upscale, tell them.** A source smaller than the composition
means the speaker is being enlarged, and that is a quality decision they should
hear before a render rather than after.

**Then ask them what kind of video this is.** Three questions, and the answers
are theirs — a product discussion and a casual monologue are not the same edit
and should not be held to one cadence:

1. what kind of video is it — yapping, product discussion, explainer, interview
2. how many seconds of talking between cutaways
3. how long each cutaway should hold

```bash
node ../../bin/style.mjs                  # show the presets, with what each one means
node ../../bin/style.mjs --style yapping --broll-every 8 --broll-hold 3.4
```

Show them the presets and let them pick; only set it yourself if they say they
do not care. It writes `style` into `project.json`, and `build-edit.mjs` folds
it in under `plan.rhythm` — so the rhythm report then measures the cut against
**their** cadence and warns when the edit drifts off it. It is not a comment.

A hold under 3.2s drops the cutaway floor to match, and says so. That floor
exists because 1–2s cutaways were watched on ep.01 and called "weird and
abrupt" — if they ask for shorter, give it to them, then make them look at it.

Everything below runs **from inside `projects/<slug>/`**. Set `PY` once:

```bash
cd projects/<slug>
PY=../../.venv/bin/python          # macOS / Linux
PY=../../.venv/Scripts/python      # Windows
node ../../bin/fetch-fonts.mjs fonts --brand nowa
```

## 2 · Understand the recording

```bash
$PY ../../bin/transcribe.py "<source>" --out work --language en
node ../../bin/aroll-clean.mjs            # proposes cuts -> work/cuts.json
```

**Stop here and show them `work/cuts.json`.** It is their voice and their call
which false starts and repeated takes go. Only then:

```bash
node ../../bin/aroll-clean.mjs --apply    # renders out/01_aroll_clean.mp4
node ../../bin/beats.mjs                  # work/beats.json — the decision points
node ../../bin/treatment.mjs              # what each beat WANTS
```

`treatment.mjs` classifies every beat **PICTURE / FOOTAGE / GRAPHIC / NONE**
before any sourcing happens. Read its output and argue with it. Skipping this
is how an episode ends up with four pictures across three minutes, because you
reached for one image for the one subject you happened to think of.

## 3 · Find footage

**If the MCP server `nowa-broll` is connected, search it before touching the
filesystem.** The catalogue is a few hundred KB of written descriptions over
14 GB of video; nearly every footage question is answerable from `search_broll`
alone.

- Search with a natural phrase, not a keyword. Results are **ranked** by how
  many terms match, so a fuller description sorts better and never returns less.
- Never search filenames. A camera calls everything `DJI_0004`.
- A result is a **SHOT**, not a clip. A 39-second take usually holds four. The
  `start`/`end` on each row is what you cut against.
- **Search everything first.** The library is filed into categories — the
  factory, the product in use — and `search_broll` covers all of them unless
  you pass `category` or `library`. Narrowing early is how you miss the shot.
  `list_broll_libraries` tells you what kinds of footage exist.
- Only call `get_broll_clip` when you need the file. It returns URLs that accept
  HTTP `Range`, so take the seconds you need, not 271 MB.
- An empty search is not proof of absence — call `broll_facets` for the
  vocabulary this footage was actually described with, then search those words.

**If it is not connected**, say this once, plainly:

> There is a shared B-roll library at https://cyrusstudio.space/broll/. Open
> **Connect an agent** and press **Copy agent brief**, then paste that to me and
> I can search every described shot without downloading any video.

Or pull the catalogue and search it offline (~3 MB, no video):

```bash
BROLL_PASSWORD=... node ../../bin/broll-pull.mjs --remote <library url>
```

To index their own footage instead — note this needs a person to look at contact
sheets, so it is not instant:

```bash
node ../../bin/broll-index.mjs "<folder of clips>" --out broll
node ../../bin/broll-review.mjs        # -> broll/review.html, browse and correct
```

## 4 · Write `edit-plan.json`

You write it, not them. Read `projects/nowa-no-touchscreen/edit-plan.json`
first — it is a finished one — and `PIPELINE.md` for every field and the card kit.

**Anchor every placement to a spoken phrase, never a timecode.** That is what
lets a re-cut re-resolve itself and one plan produce three aspect ratios.
Reference shots as `{clip, start, end, why}`.

## 5 · Build and look — do not render to check

```bash
node ../../bin/build-edit.mjs                  # under a second
npx hyperframes lint build && npx hyperframes check build
npx hyperframes snapshot build --at 3,40,86 --no-end -o build/snapshots
```

`build-edit.mjs` prints a **rhythm report**. Read it. It warns about cutaways
below the floor, one card type dominating, a graphic arriving before the
sentence that earns it, and bare stretches over 20 seconds.

To let them watch it themselves, start Studio and give them the URL:

```bash
npx hyperframes preview build          # :3002, hot-reloads on every rebuild
```

## 6 · Render, once

```bash
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build -o out/02_edit.mp4 --fps 30
```

## 7 · Sound

```bash
node ../../bin/sfx-cues.mjs
node ../../bin/mix-audio.mjs --video out/02_edit.mp4 --music <bed.mp3> --sfx sfx-cues.json --out out/final.mp4
node ../../bin/verify-mix.mjs --video out/02_edit.mp4 --music <bed.mp3>
```

**Do not ship a mix `verify-mix` fails.** It asserts the voice sits 10–20 LU
over the ducked bed. Under 10 the music covers the speaker; over 20 it reads as
no music at all. The cue sounds in `sfx/` are shared by every project.

## 8 · The other deliverables, from the same plan

```bash
node ../../bin/build-edit.mjs --plan edit-plan.9x16.json
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build-9x16 -o out/03_vertical.mp4 --fps 30
node ../../bin/sfx-cues.mjs --build build-9x16 --out sfx-cues.9x16.json
node ../../bin/mix-audio.mjs --video out/03_vertical.mp4 --music <bed.mp3> --sfx sfx-cues.9x16.json --out out/final_9x16.mp4
```

A vertical plan `extends` the master and overrides individual beats. Do not
re-cut by hand.

## 9 · Shorts, from the same edit

One long video is several posts. This reads the transcript, the pacing and what
is already on screen, and proposes self-contained moments in the 20–60s band:

```bash
node ../../bin/shorts.mjs                      # propose -> work/shorts.json
node ../../bin/shorts.mjs --approve            # read each transcript, keep or skip
node ../../bin/shorts.mjs --apply              # build only what was approved
node ../../bin/build-edit.mjs --plan edit-plan.short-01.json
```

**Approve them one at a time, on the transcript.** The tool prints each
candidate's FULL text — put that in front of them and ask whether it should be
posted, one by one. "These five look fine" is not a decision anyone made, and a
rejected candidate costs nothing while a bad post costs them.

`--apply` refuses to run with nothing approved and nothing `--pick`ed. That is
deliberate: mass-producing clips nobody has read is what this step prevents.
Approvals persist in `work/shorts.json`, matched on the window rather than the
number, so re-running after an edit never moves an approval to a different moment.

The tool reads words, pace and coverage; it cannot hear delivery or know which
line lands with their audience. Report what it flagged honestly —
`OPENS MID-THOUGHT` means the candidate starts on a bare pronoun and needs a
different first line or in-point.

It refuses rather than pads: `--want` is a ceiling, so an edit with two good
moments proposes two, and one that is a single continuous argument proposes
none and says so. That is a real answer about the video, not a failure.

Each accepted moment becomes a plan that `extends` the vertical one with the
out-of-window beats dropped and the rest rebased — the crop, captions and card
layouts are the ones already decided, and the phrase anchors inside the window
re-resolve against the shortened transcript on their own. Re-running
**overwrites** those plans, so rename one before editing it by hand.

---

## Verify from the encoded file, never the composition

Every real bug in this pipeline was invisible until someone checked the actual
output: dead reveals that the composition rendered correctly, a leaking frame
edge, 122 sound cues silently dropped because their files did not exist. If you
claim something works, check the file you are shipping.

## What to hand back

The file, what you changed and why, and anything the rhythm report warned about.
If something is wrong with the edit, say so plainly — a quiet problem you
noticed and did not mention is worse than one you missed.
