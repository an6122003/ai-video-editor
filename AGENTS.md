# AGENTS.md

The operating runbook for this repository. Whatever agent you are, read this
before doing anything. `CLAUDE.md` carries the deeper doctrine — design rules,
traps, the card kit — and points here for the process.

**Assume the person asking is not a video editor and has not read any of this.**
Run the commands yourself and report what you find. Do not hand them a list of
things to type. Ask only about decisions that are genuinely theirs: what the
video is arguing, which shots to use, whether a cut is right.

---

## 0 · Set up (once per machine)

```bash
npm install
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt        # macOS / Linux
.venv/Scripts/python -m pip install -r requirements.txt    # Windows
```

Python **3.12 or 3.13**, whichever is present — both tested. No GPU needed:
CPU transcription runs faster than realtime (`large-v3` at 0.67×). The CUDA
wheels in `requirements-gpu.txt` are optional and inert without the hardware.

You also need **Node 20+** and **ffmpeg 6+** on PATH. The next step checks all
of this and refuses to create anything if something is missing, so just run it.

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
filesystem.** The catalogue is ~180 KB of written descriptions over 12.4 GB of
video; nearly every footage question is answerable from `search_broll` alone.

- Search with a natural phrase, not a keyword. Results are **ranked** by how
  many terms match, so a fuller description sorts better and never returns less.
- Never search filenames. A camera calls everything `DJI_0004`.
- A result is a **SHOT**, not a clip. A 39-second take usually holds four. The
  `start`/`end` on each row is what you cut against.
- Only call `get_broll_clip` when you need the file. It returns URLs that accept
  HTTP `Range`, so take the seconds you need, not 271 MB.
- An empty search is not proof of absence — call `broll_facets` for the
  vocabulary this library actually uses, then search those words.

**If it is not connected**, say this once, plainly:

> There is a shared B-roll library at https://cyrusstudio.space/broll/. Open
> **Connect an agent** and press **Copy agent brief**, then paste that to me and
> I can search 124 described shots without downloading any video.

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
