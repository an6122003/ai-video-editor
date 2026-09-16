# ai-video-editor

Turn a talking-head recording and a folder of B-roll into a finished, on-brand
edit — 16:9, 9:16 and a platform-capped short, from **one** plan.

The premise: nearly every edit decision is derivable from what was said and what
the footage shows. So they are data here, not gestures. You describe the footage
once, write a plan that refers to spoken phrases, and the tools place, time,
balance, caption, score and check the result.

```
recording + B-roll  →  transcribe  →  clean  →  beats  →  treatment  →  source
                    →  plan  →  build  →  render  →  mix  →  verify  →  ship
```

---

## Quick start

```bash
git clone https://github.com/an6122003/ai-video-editor.git
cd ai-video-editor
npm install
```

Then a Python venv — **3.12 or 3.13**, whichever you already have. `python -m venv`
is the same command everywhere; only the path to the interpreter it creates
differs:

```bash
python -m venv .venv

.venv/bin/python -m pip install -r requirements.txt        # macOS / Linux
.venv/Scripts/python -m pip install -r requirements.txt    # Windows
```

`requirements.txt` is CPU-only and installs in well under a minute. Verified on
a clean 3.13 venv: every dependency has a wheel, and `bin/transcribe.py`
transcribed a 12-second clip in **1 second on CPU** with word-level timings.

**No GPU required.** Measured on real footage, CPU int8 beats realtime at every
model size — `large-v3` runs at 0.67×, so a 3½-minute episode transcribes in
about two and a half minutes on a laptop. `bin/transcribe.py --device auto` tries
CUDA and falls back on its own. The ~2.5 GB of CUDA wheels live separately in
`requirements-gpu.txt` because they are inert without the hardware.

Then, from a project directory:

Set `PY` once so the commands below are the same on either platform:

```bash
PY=../../.venv/bin/python          # macOS / Linux
PY=../../.venv/Scripts/python      # Windows
```

```bash
$PY ../../bin/transcribe.py <source.mp4> --out work --language en
node ../../bin/aroll-clean.mjs                # proposes cuts -> review work/cuts.json
node ../../bin/aroll-clean.mjs --apply        # renders the clean A-roll
node ../../bin/beats.mjs                      # the decision points
node ../../bin/treatment.mjs                  # what each beat WANTS  <- read this
node ../../bin/build-edit.mjs                 # -> build/index.html
npx hyperframes render build --out out/02_edit.mp4
node ../../bin/mix-audio.mjs --video out/02_edit.mp4 --music <bed.mp3> --sfx sfx-cues.json --out out/final.mp4
node ../../bin/verify-mix.mjs --video out/02_edit.mp4 --music <bed.mp3>
```

`PIPELINE.md` is the full manual. `projects/nowa-no-touchscreen/` is a complete
worked example — read its `edit-plan.json` against the finished video.

---

## The B-roll library

**https://cyrusstudio.space/broll/** — a searchable catalogue of described
footage, inside Nowa Studio. Sign in with the studio password.

Footage and the knowledge about it are wildly different sizes. The factory
library is **12.4 GB** of video and **180 KB** of descriptions:

| tier | size | what it gets you |
|---|---|---|
| catalogue | 180 KB | search every shot |
| thumbnails | 2.8 MB | see them |
| proxies (640p) | 82 MB | watch, scrub, cut |
| originals | 12.4 GB | final render only |

Loading the page costs about 3 MB. **You can write a complete, valid edit plan
without downloading a single frame** — plans reference clips by id and anchor to
spoken phrases, so nothing needs the media present until you render.

Pull only the tier you need:

```bash
node bin/broll-pull.mjs --remote https://cyrusstudio.space/api/broll/media/nowa-factory
node bin/broll-pull.mjs --proxies                            # +82 MB, watchable
node bin/broll-pull.mjs --plan build/plan.resolved.json      # + only the clips that plan uses
```

For ep.01 that last line pulls **2.07 GB instead of 12.4** — it uses 7 clips of
40 and puts 40 seconds on screen. After any pull, `broll/index.json` points at
whatever landed on disk, so nothing downstream takes a flag: a proxy pull simply
renders soft.

---

## Editing with an agent

The library speaks **MCP**, so an agent can search it and come back with a clip
id and an in/out without moving any video.

Open **https://cyrusstudio.space/broll/ → Connect an agent** and press
**Copy agent brief**. That copies a ready-to-paste block — connection command,
usage rules, worked example — with the token already filled in. Paste it into
whatever agent you use and it is connected.

Or by hand:

```bash
claude mcp add --transport http nowa-broll \
  https://cyrusstudio.space/api/broll/mcp \
  --header "Authorization: Bearer $BROLL_MCP_TOKEN"
```

| tool | answers |
|---|---|
| `search_broll` | "What footage shows someone using a screwdriver?" → one row per shot, with an in/out |
| `list_broll_libraries` | which libraries exist and whether originals are downloadable |
| `broll_facets` | the shot types, sequences and tags this library actually uses |
| `get_broll_clip` | one clip in full, plus download URLs |

**The whole point is that an agent answers from descriptions, not video.** Tools
return URLs rather than bytes; a 271 MB clip through a JSON-RPC envelope as
base64 would be a third larger and unresumable.

### A worked loop

1. **Ask the agent what exists.** *"What do we have of the assembly line?"* — it
   calls `search_broll` and answers from the descriptions. No download.
2. **Have it draft the beats.** Give it the script and `work/beats.json`; ask
   which beats want a picture, which want a graphic, which want footage, and
   which should stay on the speaker's face. `bin/treatment.mjs` does this
   mechanically — use the agent to argue with its answer, not to replace it.
3. **Have it propose shots per beat.** Each suggestion should arrive as
   `{clip, start, end, why}` — the shape a plan references a shot by. The
   library's *Copy selection* button emits the same shape, so a human picking in
   the browser and an agent picking over MCP produce interchangeable output.
4. **You write the plan.** Paste those into `edit-plan.json` against spoken
   phrase anchors, not timecodes.
5. **Pull only what the plan needs**, build, render, mix, verify.

The agent is doing the part it is good at — reading 124 descriptions and
remembering what is in them — and none of the part it is bad at, which is
deciding what the edit should feel like.

---

## What makes the output not look automated

Enforced at build time, not left to taste. Full table in `PIPELINE.md`.

- **Cutaway floors.** 1–2s cutaways read as a glitch; the builder auto-extends
  or drops them (3.2s full, 2.2s inset) and scales crossfades to the hold.
- **Variety.** An 11-type card kit in three registers — panel, full-frame and
  no-text. The build warns past a 20s bare stretch, 50% bare runtime, a 34%
  share for any one card type, or two of a type in a row.
- **Phrase anchoring.** Every placement is `[phrase, offset]`, resolved against
  the transcript at build time — so a re-cut re-resolves by itself. 18 of 21
  beats survived the Shorts trim untouched.
- **Nothing arrives early.** A graphic that lands before the sentence that earns
  it and then sits there is the most common defect; leads are clamped and warned.
- **A measured sound mix.** The voice must sit 10–20 LU over the ducked bed —
  `verify-mix.mjs` asserts it. 15 LU reads as "no music"; 12 LU is audible
  without covering the voice.
- **Verified from the encoded file**, never from the composition. That is how
  the dead-reveal bug, the edge leak and the silent-SFX bug were all caught.

---

## One edit, three deliverables

`edit-plan.json` is the master. Others `extends` it and override beats:

```
edit-plan.json                 16:9
└── edit-plan.9x16.json        9:16, full-bleed speaker, caption above the head
    └── edit-plan.9x16.shorts.json   under the 3:00 cap
```

Composition belongs to the deliverable, so the same beats re-resolve into a
different frame rather than being re-cut by hand.

---

## Requirements

- **Node 20+** and **ffmpeg 6+** on PATH
- **Python 3.12 or 3.13** for `bin/transcribe.py` (both tested)
- **HyperFrames 0.7.109** — pinned; `latest` is 0.8.x and untested
- `rsync` if you will publish libraries (optional; the tools fall back to
  tar-over-ssh, which resumes per file but not mid-file)

## Known limits

- `bin/face-zone.mjs` needs Swift, so the face guard is macOS-only. Elsewhere,
  set the zone by hand in `face-zone.json`.
- `bin/thumbnails.mjs` is hardcoded to 1280×720 — no vertical thumbnails yet.
- The describe pass is the one genuinely manual step. It is also the one worth
  doing properly: everything downstream reads it.
