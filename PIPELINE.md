# Pipeline — talking head + B-roll folder → finished edit

Three intelligence layers, each a separate step with a file between them so
any step can be re-run alone:

```
UNDERSTAND   transcribe.py      words with timestamps
             aroll-clean.mjs    propose cuts → review → render the clean A-roll
             beats.mjs          the clean transcript as editing beats
             broll-index.mjs    B-roll → timestamped contact sheets → described segments

DIRECT       edit-plan.json     per beat: A-roll / B-roll / card, anchored to spoken phrases
                                (written by a person or an agent reading beats + the B-roll index)

RENDER       build-edit.mjs     plan → one HyperFrames composition (cards in the brand system,
                                B-roll trims, karaoke captions)  →  lint / check / render
             sfx-cues.mjs       SFX cue list from the resolved plan, on a budget
             mix-audio.mjs      music bed ducked under speech + SFX + loudness → final.mp4
             thumbnails.mjs     3 thumbnail concepts through the same design system
```

## A project

```
projects/<name>/
  project.json            source paths, brand, composition size
  work/                   transcript.json · transcript.segments.json · cuts.json · keep.json
                          transcript.clean.json · beats.json · baked-segments.json
  broll/                  index.json (the described library) · sheets/*.jpg · described/*.json · DESCRIBE.md
  edit-plan.json          the director's decisions
  out/                    01_aroll_clean.mp4 · 02_edit.mp4 · final.mp4
  build/                  the composition (index.html, aroll.mp4 link, broll/ trims, snapshots/)
  music-brief.md · sfx-cues.json · thumbnails.json · thumbs/
```

## Run it

All commands from the project directory. Set `PY` first — the only thing that
differs between platforms is where the venv keeps its interpreter:
`PY=../../.venv/bin/python` on macOS/Linux, `PY=../../.venv/Scripts/python` on Windows.

```bash
node ../../bin/fetch-fonts.mjs fonts --brand nowa                  # once per project
$PY ../../bin/transcribe.py <source.mp4> --out work --language en   # GPU: ~1/14 of runtime
node ../../bin/aroll-clean.mjs                                      # proposes work/cuts.json — review it
node ../../bin/aroll-clean.mjs --apply                              # renders out/01_aroll_clean.mp4 + transcript.clean.json
node ../../bin/beats.mjs                                            # work/beats.json — the decision points
node ../../bin/broll-index.mjs <folder> --out broll                 # sheets + index skeleton + DESCRIBE.md
#   describe: read broll/sheets/*.jpg, write broll/described/*.json, re-run broll-index to fold in
node ../../bin/build-edit.mjs                                       # build/index.html (+ B-roll trims)
npx hyperframes lint build && PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes check build
npx hyperframes snapshot build --at 3,40,86 --no-end -o build/snapshots   # look before rendering
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build -o out/02_edit.mp4 --fps 30
node ../../bin/sfx-cues.mjs && node ../../bin/mix-audio.mjs --video out/02_edit.mp4 --music music/bed.mp3 --sfx sfx-cues.json --out out/final.mp4
node ../../bin/verify-mix.mjs --video out/02_edit.mp4 --music music/bed.mp3   # 10-20 LU or it fails
node ../../bin/thumbnails.mjs
```

Then the other frames, from the same plan (see §"Vertical, from the same edit"):

```bash
node ../../bin/build-edit.mjs --plan edit-plan.9x16.json                  # 1080x1920
npx hyperframes lint build-9x16 && PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes check build-9x16
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build-9x16 -o out/03_vertical.mp4 --fps 30
node ../../bin/sfx-cues.mjs --build build-9x16 --out sfx-cues.9x16.json
node ../../bin/mix-audio.mjs --video out/03_vertical.mp4 --music music/bed.mp3 --sfx sfx-cues.9x16.json --out out/final_9x16.mp4
```

## The rhythm rules (enforced on every build)

Two complaints drove these, and both are now checked by the builder rather than
left to whoever writes the plan:

**1. Cutaways that flash.** A 1–2s cutaway reads as a flinch — the eye needs
~0.4s to leave the speaker and ~0.4s to come back, so a 2s shot is barely up.
Floors: **3.2s for a full-frame cutaway, 2.2s for an inset** (an inset is
gentler; the speaker never leaves). A shot under the floor is **extended** into
the gap ahead of it, or pulled earlier, up to whatever the source clip holds —
and **dropped** if it still cannot reach the floor, because no cutaway beats a
flashed one. Crossfades now scale with the hold (`dur × 0.11`, clamped to
0.22–0.45s) instead of a fixed 0.3s.

**2. Every card being a box with text.** The kit is now eleven presentations in
three registers, and the build warns when one of them dominates:

| register | types |
| --- | --- |
| panel (a surface in one corner) | `lower-third` `bignum` `process` `checklist` `callout` `timeline` |
| full-frame (takes the frame) | `statement` `list` `compare` `quote` `endcard` |
| no-text (drawn on the footage) | `annotate` `cells` |

- `statement` — one thought, lines rising out from behind masks
- `list` — full-frame, numbered or bare, items landing on the words
- `compare` — two columns, hard seam, coral on the winning side
- `quote` — his own sentence brightening word by word as he says it
- `annotate` — a coral circle / arrow / underline / bracket drawn onto the
  footage, stroke-on via `dashoffset`, no text at all
- `cells` — pixel cells lighting up: a quantity you see instead of read
- Full-frame types take `over: "footage"` to swap the fill for a scrim.
- Panels take `side` (left|right) **and `v` (top|mid|bottom)**, so consecutive
  cards don't all land in the same rectangle.
- Entrances: `rise` `plant` `fade` `wipe` `dither` (a chunky stepped wipe —
  the sanctioned pixel register), with sensible defaults per type.

### The layout library

A card has two axes: **`type`** is what the data *is*; **`layout`** is how it looks.
The same three bullets can be numbered rows, a grid of tiles, a staircase, a stack
of huge lines or a cluster of chips — so variety no longer means inventing a type.

```bash
node ../../bin/layouts.mjs          # -> layouts/index.html, every presentation, browsable
node ../../bin/layouts.mjs --only list,bignum --bg none
```

The page renders each one at true 1920x1080 over this project's own footage, with a
day/night switch and a backdrop toggle (a layout that reads on a plain ground can
vanish over a face), and a click-to-copy JSON snippet per card. It reads the
renderers *and* the stylesheet out of `bin/build-edit.mjs` at run time, so it cannot
drift from what the builder actually produces.

**57 presentations across 14 types.** Omit `layout` and the type's default is used.

| type | layouts |
| --- | --- |
| `lower-third` | `bar` `rule` |
| `bignum` | `panel` `hero` `split` `stack` `fraction` `meter` |
| `list` | `rows` `grid` `stack` `chips` `index` `steps` `columns` |
| `checklist` | `rows` `grid` |
| `process` | `chips` `rail` |
| `callout` | `panel` `bar` `sticker` |
| `timeline` | `rows` `track` |
| `statement` | `masked` `center` `oversize` `blocks` |
| `quote` | `rail` `center` `card` |
| `compare` | `columns` `stack` `versus` `bars` |
| `plate` | **scenes:** `hero` `duo` `trio` `quad` `wide` · **single:** `frame` `full` `inset` `polaroid` |
| `endcard` | `center` `split` |
| `annotate` | `mark` (shapes: circle/underline/arrow/bracket) `spotlight` |
| `cells` | `row` `grid` `bar` |

The variety warnings count **`type:layout` pairs**, so two lists in different
layouts are two different things to look at — which is the point.

#### Image scenes

`plate` layouts `hero` `duo` `trio` `quad` `wide` are the full-frame picture
scenes: the brand's graph-paper ground, the copy stacked in ink/coral blocks on
the left, and one to four framed pictures on the right — **each carrying its own
`Source:` chip**, drawn from the manifest so the credit cannot drift from the
licence. `title` splits on `" / "` into the stacked blocks.

```json
{ "type": "plate", "layout": "trio",
  "eyebrow": "SOURCE VISUAL",
  "title": "Main headline here / supporting statement",
  "caption": "Add a short caption or context about these images here.",
  "images": [ { "file": "candidates/x/01.jpg" }, { "file": "candidates/x/02.jpg" }, { "file": "candidates/x/03.jpg" } ] }
```

`hero` takes 1 picture, `duo` 2 (the second overlapping at the corner), `trio` 3
(one large plus a column of two), `quad` 4 (one large plus a row of three), and
`wide` gives a single picture the frame with the copy tucked into the corner.

**A scene slot holds a still OR one of our own B-roll clips**, and mixing them in
one scene is fine. Use `media` instead of `images`, and give a clip the same
`clip` + `in` a cutaway takes:

```json
{ "type": "plate", "layout": "trio",
  "eyebrow": "SO WE BUILT IT", "title": "That is how / Nowa was born",
  "caption": "The same loop, on hardware that can carry it.",
  "media": [ { "clip": "dji-20260805100940-0028-d", "in": 0, "dur": 9 },
             { "clip": "dji-20260805094747-0018-d", "in": 20, "dur": 9 },
             { "file": "candidates/tamagotchi/11.png" } ] }
```

Clips are cut once at 1280x720 into `build/broll/scene-*.mp4` (a framed slot can
never show more), then played as framework-timed media for the card's life — so
three clips run at once inside the frames. **The builder sets each clip's length
from the card, not from the plan**: a shorter cut ends mid-card, the runtime
hides it, and the slot goes blank white. If the source has less footage left
after `in` than the card needs, the build says so rather than letting the frame
empty out. Each slot takes **its own track**,
because slots in one scene are simultaneous and the runtime rejects overlapping
clips on a shared track. Our own footage carries no `Source:` chip; it is ours.

This is the alternative to a full-frame cutaway: three related shots side by side
on the brand ground, rather than three cuts in a row.

### The face guard

**No panel may cover the speaker's eyes.** Panels have a knowable footprint, so
the builder checks it against `plan.face` and *moves the card* rather than let it
land on him — the other side first, then the low band, then the high one — and
warns if nothing clears.

What it protects is the **eye line**, not the whole head: the upper 60% of the
measured face box. A graphic across the jaw is an ordinary lower-third; one
across the eyes kills the shot. That is what keeps the band under the chin
usable, which is where a wide panel has to live.

A panel wider than 55% of the frame (`timeline:track`, `process:chips`, or
anything with an explicit `width`) **centres horizontally and drops into that
lower band** instead of sitting in a corner. Override per card with `x`, `v`
(`top`/`mid`/`bottom`), `centre: true`, or `ignoreFace: true` when the shot
genuinely allows it.

### Reviewing the B-roll index

The described library is a lot of JSON to trust unseen, so it has a viewer:

```bash
node ../../bin/broll-review.mjs          # -> broll/review.html
node ../../bin/broll-review.mjs --clip lap-loa --force
```

A **grid of cards, one per segment** — not per clip, because a 39-second take
usually holds four different shots and "the one where he turns the shell over"
is a segment. Each card carries the frame, the clip id, the in/out, the length,
the frame shape and the action line, so a shot is picked by looking.

Search matches **what is in the shot** — action, subject, tags, shot, motion,
sequence, note — as well as the clip id, so `screwdriver` finds four shots and
`speaker grille` finds three. Filter by sequence or shot type, or show only what
is marked unusable. The circle selects; **Copy selected** puts
`{clip, start, end, why}` on the clipboard, which is the shape a plan references
a shot by.

Clicking a card opens an editor drawer with every field. Correct anything, press
**Download corrections**, drop the file into `broll/described/` and re-run
`broll-index.mjs` to fold it in. The page never writes to disk — the describe
pass stays append-only, so nothing already described can be silently overwritten
by a stray edit.

The segment thumbnails are **committed** (~2.8 MB for 40 clips). They look like
build output, but they are derived from footage a collaborator does not have, so
from their side they are source. Without them a fresh clone renders 124 broken
images and cannot regenerate one.

### A library too big to hand over

The footage and the knowledge about it are wildly different sizes, and the
pipeline is worth nothing to anyone who cannot get both. For the 40-clip factory
library:

| | size | what it lets someone do |
|---|---|---|
| `library.json` | 180 KB | search all 124 shots |
| `thumbs/` | 2.8 MB | see them |
| `proxy/` (640p) | ~70 MB | watch, scrub, cut, draft-render |
| `original/` | 12.4 GB | final render |

A 640p proxy measures **2.5 MB/min against 419 MB/min** for the source — 166x
smaller — so the whole 27.6-minute library is smaller than one finished episode.
And the demand is lopsided: ep.01 puts **40 seconds** of B-roll on screen and
touches **7 clips of 40**. Handing someone 12.4 GB to use 40 seconds is the
thing this fixes.

Publish to any static HTTPS server — no SDK, no credential, no object-store API:

```bash
node ../../bin/broll-publish.mjs --base https://media.example.com/broll/nowa-factory
rsync -av --delete dist/broll/ you@server:/var/www/nowa-factory/
```

Clients then pull only the tier they need:

```bash
node ../../bin/broll-pull.mjs --remote https://media.example.com/broll/nowa-factory
node ../../bin/broll-pull.mjs --proxies                              # + 82 MB, now watchable
node ../../bin/broll-pull.mjs --plan build-9x16/plan.resolved.json   # + the 7 clips that plan uses
```

Measured end to end against a real server: a client who has pulled **3.1 MB and
no video at all** renders all 124 cards with no broken images and finds three
shots for `speaker grille`. Re-running pulls 0.0 MB, and every file is checked
against the catalogue's sha256.

There is deliberately **no byte-range mode**. Turning "the seconds this plan
uses" into byte offsets means parsing the MP4's moov atom; slicing by
proportional position yields fragments nothing decodes, so such a flag could
only fall back to the whole file — looking like it saved bandwidth while
downloading everything. If tier 3 ever hurts, the fix is for `broll-publish` to
cut each described segment as its own file: measured on ep.01 that is 803 MB
instead of 2.07 GB, needs no MP4 parsing, and every file stays valid on its own.

Because a plan anchors to spoken phrases and references clips by id, **a client
can write a complete, valid edit plan having never downloaded a frame.**

**The catalogue is served, not committed.** The library grows on its own clock:
you shoot more, describe it, re-publish, and every client sees the new shots by
running `broll-pull` — nobody re-clones. The version is a fingerprint of the
content, not a counter anyone has to remember to bump.

`broll/library.lock` records the version a project was cut against — commit it.
When the library moves on, the lock is what says whether an edit still refers to
the footage it was made from.

After any pull, `broll/index.json` is rewritten with `path` pointing at whatever
is actually on disk. **Nothing downstream takes a flag**: `build-edit.mjs` builds
from what it finds, so a proxy pull gives a soft draft and an original pull gives
the real thing. `--ranges` falls back to the whole file on a server without Range
support, or when a byte-sliced MP4 will not decode — a correct clip beats a
clever one.

### The step between the script and the plan

`bin/treatment.mjs` reads the beats and says what each one WANTS, before any
searching happens. Without it the sourcing is ad hoc: you reach for one image
for the one subject you happen to think of, and a three-minute video ends up
with four pictures — which is exactly what happened on ep.01's first pass.

```bash
node ../../bin/treatment.mjs --own "Daniel"        # -> work/treatment.json
node ../../bin/treatment.mjs --queries             # just the search list
node ../../bin/treatment.mjs --apply-search --n 12 # run every search it proposes
```

Four classifications, in priority order:

| | when | what it becomes |
| --- | --- | --- |
| **PICTURE** | names someone else's thing, or a thing the B-roll library has no clip of | a search, then a `plate` |
| **FOOTAGE** | the library already shows what he is talking about | a cutaway |
| **GRAPHIC** | carries a figure, a sequence, a contrast or a claim — a shape, not a thing | a card |
| **NONE** | addressing the viewer, or nothing to show and no shape to draw | leave it on his face |

Ep.01: **9 picture beats over 81s**, 5 graphic, 7 footage, 4 none.

Two things it took to make this useful rather than noise:

- **Match on THINGS, not on words.** The first version compared every word in a
  beat against every word in the B-roll descriptions, so "through", "past",
  "fun" and "second" counted as evidence that the footage covered a beat — and
  all 25 beats came back FOOTAGE with zero searches. The vocabulary is now an
  explicit list of things you can point a camera at.
- **A query needs its qualifier.** The bare noun is useless: "album" searches for
  record sleeves. Queries are built from the phrase the thing sits in — the
  content words immediately before it in what he actually said — and any query
  that still comes out as one word is flagged for a human to fix. `--own` marks
  the names that belong to us, or the classifier proposes searching Google for
  "daniel toy" because a capitalised word it does not recognise looks exactly
  like someone else's product.

It proposes; it cannot know that "the dad's face" is a joke rather than a request
for a stock photo of a man. Every row carries the evidence it used.

### A full-bleed picture carries nothing but the picture

`plate:full` is the treatment for a picture beat: the image fills the frame and
the only thing on it is a `Source:` chip. No frame, no eyebrow, no headline, no
caption — a photograph that needs a paragraph explaining it is the wrong
photograph. Two things had to change for that to be true:

- `object-fit` was `contain`, which letterboxed every picture into a band with
  ink above and below — the "single image just sitting there" look the layout
  exists to avoid. It is `cover`.
- The manifest's `caption` is a convenience for the FRAMED layouts and
  `plate:full` no longer inherits it, so a full-bleed shot does not arrive with
  an editorial line and a full credit sentence stacked on top of each other.

**A short full-bleed still counts as a cutaway, not as full-frame.** The 25%
full-frame cap exists to stop the video becoming a slideshow with narration —
it is about walls of TYPE taking the screen away from the speaker. A 3-second
photograph is functionally a B-roll cut, so `isPictureCut()` (full-frame, has
media, under `rhythm.stillCutaway` = 5s) is counted with the cutaways and
reported separately. Without that distinction, adding the pictures the script
actually calls for trips a rule written about something else.

### Sourced images (`plate`)

For things the video names but has no footage of. `bin/image-search.mjs` searches
**Openverse** and **Wikimedia Commons**, filtered to commercial-use licences
(CC0 / public domain / CC-BY by default; NC and ND are never returned, and the
filter is applied client-side too because the Commons API cannot do it).

**Google Images** is the third provider — `--source serper` (serper.dev) or
`--source serpapi`, two different services with different keys. It reaches far
more than the licensed libraries together, which is the point of having it, and
it is what to reach for when the libraries come up empty. Two things to know:

1. The usage-rights filter is a **bias, not a guarantee**, on two counts.
   SerpApi passes `tbs` through to Google but [does not document the licence
   tokens](https://serpapi.com/images-results), so `il:cl` is sent on the
   strength of Google's own UI — and an unrecognised `tbs` token is *ignored*
   rather than rejected, which would hand back unfiltered results under a filter
   you thought you had applied. Even when it works, Google reports what a page
   *claims*: no licence name, version or creator. So these results are recorded
   as `license: "unverified"`, the licence filter cannot judge them, and the
   review card tells you to open the source page and establish the licence
   yourself. `--serpapi-tbs <token>` overrides it; `--serpapi-any-rights` drops
   it entirely.
2. Google returns **no licence at all**, so results are recorded as
   `license: "unverified"` and the credit chip carries the domain they came
   from. Whether that is enough for a given video is the owner's call, not the
   tool's; the builder still refuses anything not marked `approved` in
   `media/sources.json`, so the decision is always explicit and recorded.

**Use Google as a lookup even when you cannot use its pictures.** Ep.01 needed a
side-trackwheel BlackBerry and the libraries had nothing usable. Google found
plenty — and named the models. Searching Openverse and Commons for *those model
numbers* (8700, 7290, 6230) is how you turn an unusable result into a licensed
one. It did not pay off here (the only licensed trackwheel shot was 480x640 and
soft) but it costs one command and it is the right order of operations.

The key never goes in a tracked file. `serper` reads `--serper-key`, then
`$SERPER_API_KEY` / `$SERPER_KEY` / `$SERPAPI_KEY`, then `.serpapi-key`,
`.env.local` or `.env` in the repo root — all gitignored. It says which name it
found the key under when that is not the canonical one, because a key for the
wrong service returns a bare `401` and looks exactly like a typo (which is what
happened here: a serper.dev key sitting under `SERPAPI_KEY`). Running the provider
without a key prints the exact paths, and says so separately if the file still
holds the placeholder text rather than a key.

Encoding matters more than it should: PowerShell's `>` writes **UTF-16LE with a
BOM**, so a key file created the obvious way on Windows is not UTF-8 and reading
it as UTF-8 gives `�S\0E\0R\0P...` — a key that never matches and never
explains why. The reader sniffs the BOM and falls back to an interleaved-NUL
test, so UTF-8, UTF-16 and BOM-less all work.

Do not reach for a scraped web search instead: **Google serves a CAPTCHA to
automated browsers** (bot detection, not something to work around), and the
engines that do answer return Amazon, Pinterest and stock listings — pictures
without rights.

```bash
node ../../bin/image-search.mjs --from-transcript      # what does he name that we can't show?
node ../../bin/image-search.mjs "grace hopper" --n 20  # licensed libraries
node ../../bin/image-search.mjs "blackberry trackwheel" --source serper --n 30
# open media/review.html, then set "approved": true in media/sources.json
```

Then place it, and the builder frames it in the brand surface and prints the credit:

```json
{ "type": "plate", "layout": "frame", "file": "candidates/hopper/03.jpg", "caption": "..." }
```

**The builder refuses any plate that is not `approved` in `media/sources.json`**, and
builds the on-screen credit from that record rather than from the plan, so the
credit cannot drift from the licence.

> **A licence on a photograph is not permission for what it depicts.** A CC-BY photo
> of a Pikachu plush is still Nintendo's character; a CC-BY photo of a person is
> still that person's likeness. The review page says so on every card. This is why
> approval is a human step and always will be.

### Balance, and never a still frame

Two more failures the build now catches, both from watching real cuts:

**A full-frame card takes the speaker off screen.** Past a quarter of the runtime
the video stops being a person talking and becomes a slideshow with narration.
The build reports the split and warns past **25% full-frame**, and warns again
when two full-frame cards land **within 3s of each other** — that is one long
absence, however it is written. `list:panel` exists precisely so a list does not
force a takeover.

**A card with nothing timed to the words is a still frame.** Past **8s** without
`reveal` anchors the build says so. `quote` and `cells` are exempt — they
brighten and fill on their own — and so is a `plate` scene holding video.

So every surface also moves for its whole life, in one linear tween each (never
a loop, because a seek must land on the right frame):

- the **graph-paper ground drifts** across every full-frame card, scaled to the
  hold (~9px/s, 45–140px total)
- **stills in a scene get a slow push-in** (up to 1.09×) — a video slot moves on
  its own and is left alone
- long full-frame holds get a **slow content rise** on top of the drift
- the `.el` stagger **spreads across the hold** instead of finishing in 300ms, so
  a 12s card is still arriving while he is still talking about it
- `statement`, `list`, `checklist`, `compare`, `process` and `timeline` take
  `reveal` anchors, so lines, rows, columns and milestones land on the words that
  motivate them rather than appearing finished

**Three things break a reveal silently.** All three were live in shipped builds
and were found only by pulling frames out of the encoded file at the reveal
times — the composition looked correct:

1. **Positional selectors.** A `compare` has seams between its columns and a
   `timeline:track` has a rail among its stops, so `:nth-child(2)` addresses the
   seam and the second side never arrives. Every revealed item carries `data-i`
   and every reveal selects by it.
2. **The `.el` stagger fighting the reveal.** Row elements carry `el` as well as
   their own class, so the stagger's `opacity:1` at `at+0.12` undid the reveal's
   arming `opacity:0` at `at`. The items appeared together with the card and then
   held still for the rest of it — the exact fault reveals exist to fix, and it
   affected every `list` and `checklist` card in every episode until ep.01's
   second pass. `revealOwns()` now excludes them: `.el:not(.lp-row)`.
3. **An anchor before the card's own start.** `at` moves later during overlap
   resolution and the face guard, so a phrase that was inside the card when the
   plan was written can end up before it. The reveal then fires while the card is
   still hidden and the arming set clobbers it afterwards, so the item never
   appears at all. Offsets are clamped into the card's life and the build prints
   `REVEAL: <beat> item N is anchored 1.3s before the card appears` — the clamp
   keeps the build honest, but the fix is to re-anchor the plan.

**Thresholds** (override per project under `plan.rhythm`):

| rule | limit |
| --- | --- |
| unbroken talking head, any one stretch | 20s |
| bare talking head, share of runtime | 50% |
| any single card type, share of cards | 34% |
| same card type in a row | 2 |
| full-frame cards, share of runtime | 25% |
| gap between two full-frame cards | 3s |
| a card held with no `reveal` anchors | 8s |
| a `reveal` anchored before its card appears | clamped, warns |

Every build prints coverage, the list of shot lengths, the card-type histogram
and the longest bare stretch, then warns on each rule it breaks. Ep.01's plan,
re-run against these rules, reports `5 of 9 cards are "callout" (56%)` and
`22s of unbroken talking head` — which is exactly the criticism, caught
automatically.

**Captions** get a gradient scrim over the bottom 260px (not a box — the design
system rules those out). White captions over bright footage measured 2.8:1 and
failed AA no matter how heavy the text shadow was, because a shadow does not
raise the background's luminance.

### The sound mix, measured

`bin/mix-audio.mjs` lays the bed under the voice; `bin/verify-mix.mjs` says
whether it worked. Both build the bed from `bin/lib/bed.mjs`, so the thing being
measured is the thing being shipped.

```bash
node ../../bin/mix-audio.mjs  --video out/02_edit.mp4 --music "H:/backup/DJI/Music/Cosy - Dyalla.mp3"                               --music-db -9 --sfx sfx-cues.json --out out/final.mp4
node ../../bin/verify-mix.mjs --video out/02_edit.mp4 --music "H:/backup/DJI/Music/Cosy - Dyalla.mp3" --music-db -9
```

The verifier derives **speech windows** from `work/transcript.clean.json` (word
intervals, gaps under 0.25s merged) and their complement as **pauses**, then
measures the voice and the bed in each. It reports:

| line | what it means |
| --- | --- |
| voice, while speaking | the dialogue's own loudness |
| music, undacked | the bed at `--music-db` before the duck |
| music, while he speaks | what the duck actually left |
| separation over speech | the number that matters — want **10-20 LU** |
| gain reduction | how far the duck moved it |

Under 10 LU the music is covering the voice. Over 20 there is no point having
music. Ep.01 ships at **15.0 LU** with 8.3 LU of duck, which errs quiet on
purpose.

**Four traps, each of which produced a wrong mix before it was measured:**

- `alimiter` defaults to `level=enabled`, which auto-normalises the output back
  toward 0 dBFS and undoes `loudnorm`. Lowering the ceiling made the file
  *louder* (−15.1 → −13.2 LUFS, true peak +0.2 dBTP). Always `level=disabled`.
- Single-pass `loudnorm` applies a gain that **varies over time**: the programme
  averages −14 while the voice-to-bed balance quietly moves around. The mixer
  measures in pass 1 and applies `linear=true` in pass 2 — one static gain.
- A library track **fades out**, usually over longer than a crossfade covers.
  `Cosy - Dyalla` is 141s under a 200s video and its outro starts at **129s** —
  by 138s it is 32 dB below its own body. Butt-joined it goes to silence at 2:21;
  crossfaded over 6s it still left a ten-second trough, because both copies are
  already fading inside the overlap. `usableBody()` profiles the track in 2s
  windows and returns the stretch within 6 dB of its own average, `bedGraph()`
  loops **that**, and the seams use `c1=qsin:c2=qsin` — the equal-power curve.
  A linear (`tri`) crossfade sums two uncorrelated signals to −3 dB at the
  midpoint, which is an audible dip in the bed at every seam.
- `sidechaincompress` at `ratio=8` **never releases** on a talking-head video —
  96% of the runtime is speech and the release is 450ms, so the bed sat 25 LU
  down and inaudible for the whole video. The default is `4:1`; set the level
  with `--music-db` against a measured result rather than guessing.

Delivery: **−14.5 LUFS integrated, −1.2 dBTP, LRA 4.9** — inside YouTube's target.

**A bed can be too quiet to exist.** Ep.01 first shipped at `--music-db -9`,
15 LU under the voice, and the note that came back was "you missed the music".
It was there — proved by a band test rather than an argument: from the
voice-only render to the mix, the full-band level rose 1.97 dB (loudnorm's
static gain) while the **40-90 Hz band rose 4.76 dB**, and that 2.8 dB of extra
sub-bass is the bed. A null test is useless here, because the two files have
different AAC priming and will not align. So the default is now `-6dB`, which
measures **11.9 LU** — audible on a phone, still clearly under the voice.

`--music-db` defaults to **−9** in both tools, which is the value ep.01 was
verified at. It is not a guess to be carried over blindly: a louder track, or a
quieter voice, moves the result, so re-run the verifier per episode.

## Vertical, from the same edit

One plan, three deliverables. `edit-plan.json` is the master; the vertical cut
and the Shorts cut EXTEND it rather than copying it, because three copies of 22
beats drift apart within one revision.

```bash
node ../../bin/build-edit.mjs                                  # 1920x1080 -> build/
node ../../bin/build-edit.mjs --plan edit-plan.9x16.json        # 1080x1920 -> build-9x16/
node ../../bin/build-edit.mjs --plan edit-plan.9x16.shorts.json # the same, under 3:00
```

A child plan overrides top-level keys and patches beats by id through
`beatOverrides`; `"b12": null` drops one. The chain resolves base-first and
refuses an id that is not in it, so a rename cannot silently lose an override.
The composition comes from `plan.composition` (or `--composition WxH`), never
from the project — the frame is a property of the deliverable.

### The talking head: full-bleed, or in a band

`plan.arollFit` picks one. **`"full"` is the default** — the footage is cropped to
the speaker and fills the frame, cards overlay it, which is what a vertical feed
expects and what ep.01 ships.

It has a cost, and the cost is fixed by the source. Ep.01's A-roll is **1280x720**,
so a 9:16 crop of it is **405x720 of real pixels scaled 2.67x**. Nothing recovers
that. What the builder does instead is refuse to waste it: rather than leave the
renderer to stretch a `<video>` element bilinearly, it crops and rescales the
A-roll itself, once, with lanczos and a light unsharp:

```
crop=608:1080:(iw-608)/2:0, scale=1080:1920:flags=lanczos, unsharp=5:5:0.6:5:5:0.0
```

Measured on a face crop as mean |Laplacian| — edge energy, i.e. how much local
detail survives:

| chain | edge energy |
| --- | --- |
| bilinear (what the browser would do) | 3.38 |
| lanczos | 4.26 |
| **lanczos + unsharp 0.6** (default) | **5.69** |
| denoise + lanczos + unsharp 0.9 | 6.03 |

The default is the third row: +68% over the browser, and inspecting the frame
shows individual eyebrow hairs with no halo ringing along the hairline. The
fourth row scores higher but buys it with a denoise pass that costs skin texture,
so it is not the default — override with `plan.arollFilter` if a source wants it.
The pre-scaled A-roll is cached in `<build>/aroll.mp4`, carries the audio through
with `-c:a copy`, and only exists for portrait full-bleed.

**`"band"` is the alternative**: the footage at 1:1 in a full-width window, with
the cards in the room underneath. Sharper — the band height defaults to the value
that makes the scale exactly 1.00x — but it gives up the full-frame look, so it is
opt-in. In band mode the frame also gains `plan.rail` (the series line above the
window) and `plan.standing` (the question the episode answers, in the card zone),
which fill the room during the 34% of runtime that is bare talking head; both step
aside on the timeline under anything that covers them. Neither exists full-bleed,
because there is no room to fill.

Either way the build prints what the viewer actually gets:

```
portrait 1080x1920: A-roll full-bleed, cropped to 9:16 — 405x720 real pixels
                    scaled 2.67x (lanczos + unsharp, not the browser's bilinear)
face box maps to x 231-844, y 231-1024; panels 998px wide, 190-1560px, ...
```

### What the builder changes on its own in portrait

- **Side-by-side layouts stack.** `VERT_LAYOUT` maps `compare:versus`/`columns`
  -> `stack`, `bignum:split` -> `stack`, `timeline:track` -> `rows`,
  `list:columns`/`grid`/`index` -> `rows`, `process:chips` -> `rail`,
  `endcard:split` -> `center`, `quote:rail` -> `card`. Two columns in a
  1080-wide frame are two slivers. The report names every swap.
- **Panels are full-width and sit low.** At 998px they are wider than 55% of the
  frame, so they centre horizontally and default to the bottom of the safe area —
  under the chin, above the caption. `v: top|mid|bottom` is relative to that
  area, and in band mode to the card zone below the window. Landscape `mid` is
  deliberately still the FRAME's centre: a portrait feature has no business
  moving every mid panel in a delivered 16:9 cut up by 42px.
- **`list:panel`'s full-height column is unlocked.** It is a deliberate
  full-height column in landscape and a near-full-frame takeover in portrait.
- **Panels get their card surface back.** A day `list` face is `--parchment`,
  which is invisible against the parchment ground band mode puts behind it, so
  the panel layouts are forced back to a white face with stepped corners. It
  reads over footage too, which is why it is not scoped to band mode.
- **Every cutaway is full-bleed.** An inset is a landscape idea — footage
  *beside* the speaker — and portrait has no "beside". Played inside the band it
  left two thirds of the frame empty at the one moment footage should be filling
  it. The 4K B-roll is cropped to the frame, so it costs no sharpness at all.
- **Captions become an ink chip that hugs the words**, not white text on a
  gradient scrim. Over parchment a scrim is a grey smudge and no text shadow can
  fix it, because a shadow does not raise the background's luminance. The chip
  reads over footage, parchment and an ink card alike, and `:empty` hides it
  between chunks. Over an ink card the chip is invisible and the white text is
  ~15:1 on its own — that is correct, not a bug.
- **Portrait splits the frame in three: caption, speaker, cards.** He owns the
  middle, so nothing has to cross his face at all:
  - the **caption sits above his head**, its bottom edge 16px clear of the
    mapped face box (`CAP_POS`, default `"top"` in portrait — `plan.captionPos:
    "bottom"` keeps the landscape habit)
  - **cards live in the band under his chin**, `ZONE = { face bottom + 24,
    H - BOT_SAFE }`, with `BOT_SAFE` at 20% of the frame because TikTok and
    Reels draw the username, description and buttons over roughly the bottom
    fifth and will put their text on top of ours
  The face guard is still there but becomes a backstop rather than the thing
  doing the work — which is the right relationship. Landscape is untouched: one
  180px margin with the caption band inside it.
- **Display type scales to the frame** (the oversize statement would otherwise
  run off both edges) while body copy, rows and labels go the OTHER way — a
  vertical cut is watched on a phone, often muted, so the small type gets bigger.
- **The face box is re-measured through the crop.** `plan.face` is in the
  A-roll's coordinates; portrait shows a centre crop of it, so the box is mapped
  through the same `object-fit: cover` transform the browser applies — into the
  whole frame full-bleed, into the window in band mode. In landscape the rect and
  the file share an aspect and the maths is the identity. Without it the guard
  defends a part of the frame he is not in: on ep.01 the mapped box is
  x 231-844, y 231-1024, and the guard moved `b09` off his eyes on the first
  full-bleed build.

### A vertical card is not a landscape card resized

The first vertical pass scaled the landscape sheet to about 0.65 and dropped it
into 1080x1920. The result came back as "weirdly empty and out of proportional",
and that was the correct read: a layout composed for a wide frame leaves a small
block of type sitting in the middle third with a third of the canvas empty above
and below it. `PORTRAIT_CSS` is now its own ruleset with its own reasoning, not a
scale factor.

**A full-frame card in portrait is a poster.** Display type is set against the
frame's WIDTH — roughly 968px of usable measure — so a line spans it and wrapping
to three or four lines is the intended result:

| | landscape | portrait |
| --- | --- | --- |
| `.stmt-line` | 88px | **150px** |
| `.stmt--over .stmt-line` | 132px | **168px** |
| `.numrow--hero .num` | 380px | **660px** |
| `.cmp-big` | 76px | **116px** |
| `.stb span` (statement:blocks) | 54px | **92px** |
| `.pblk span` (plate scenes) | 54px | **84px** |

Two traps came straight back out of that:

- `statement:blocks` sizes its own `.stb span`, so it missed the line size and
  stayed a small box in a big field. Its stepped indent also had to shrink —
  64px per line walks the last block off a 1080 frame.
- A 760px numeral at `line-height: 0.86` collided with the eyebrow above and the
  label below, at 19 sample points. Onest's ink box runs taller than 1em; 1.18 is
  the floor that holds at 660px. This is the same trap the traps list already
  warned about, at a size where it bites much harder.

**A panel is the opposite problem** and stays compact — it lives in the band
under his chin and must not grow into his face. But a PICTURE earns the taller
band that starts just under the eye line (`ZONE_PIC`): a photograph needs the
height to be worth showing, and a graphic across the jaw is an ordinary lower
third. `plate` also has its own positioning branch, which centred it in the frame
and put it straight over his eyes the moment the picture got big enough — that
branch is now zone-aware too.

**`plate:inset` is a picture with a line under it**, not a card carrying four
pieces of text around a thumbnail. In portrait the eyebrow is hidden, the image
takes the card's full width, and the credit shrinks to a footnote — it stays,
because the source is always credited.

### A slideshow, for a stretch that one picture cannot carry

`plate:slides` holds several pictures in one frame, each arriving on the phrase
that calls for it:

```json
{ "type": "plate", "layout": "slides",
  "caption": "Then the ball. Then a flat pad.",
  "media": [
    { "file": "candidates/trackball/04.jpg",  "at": ["second version", -0.1] },
    { "file": "candidates/blackberry/15.jpg", "at": ["little ball in the middle", 1.4] } ] }
```

Each slide's `at` resolves against the card's own start, so it survives a re-cut
like every other placement. Cross-fades are one-shot linear tweens — a seek to
any frame has to land on exactly one visible slide — and each slide carries its
OWN source chip, because they rarely come from the same place. A card that
changes picture is exempt from the reveal-or-shorten rule the same way a video
scene is.

Slides share one box, so they cannot each take their own aspect the way a single
plate can: they use `object-fit: contain` and letterbox on the white mount, which
on a card reads as a photo album. `cover` cropped a portrait phone shot down to
its background.

**This is where a card may become a different TYPE per format.** Ep.01's
wheel/ball/pad story is a `timeline:track` in 16:9 — three stops on a rail, which
reads left to right across a wide frame. On a phone that same card is a list of
short lines, so vertical runs it as `plate:slides` instead. Same argument, the
form the frame can carry.

### B-roll: three ways to put a shot in a frame it does not match

| `fit` | what it does | when |
| --- | --- | --- |
| `cover` (default) | fill the frame, crop the overflow | details, textures, wides |
| `whole` | fit the WIDTH, blurred fill above and below | product macros, anything where the whole object matters |
| `pillar` | the transpose — fit the height, fill the sides | a portrait source in a landscape frame |

A 9:16 crop of a 16:9 shot keeps **31.6% of its width**, which is right for a
detail and wrong for a macro — ep.01's device macro came back as a screen edge
and two buttons. `whole` loses nothing.

The blurred fill is a **zoomed** centre of the same frame, not a straight crop of
it. A crop inherits the source's own composition, so the first attempt put a
black void above the picture (the shot's dark tray) and a readable close-up
below — three banded strips instead of one surround. Blown up 1.4x the frame
height, blurred at sigma 64 and taken down in brightness and saturation, it
becomes a wash of the colours immediately behind the subject.

### Two rules against a graphic getting ahead of the script

"It appears too soon and just stands still there" is two separate faults, so
there are two rules. Both count as `rhythm` overrides.

**A placement may not lead its own words.** `T()` takes a `maxLead` wherever an
item's START is resolved, and a negative offset past `MAX_LEAD` (0.6s) is clamped
with a `LEAD:` warning naming the beat and the phrase. `until`-style specs are
left alone — stopping just before a phrase begins is a normal thing to ask for.
Ep.01's master plan had six placements leading their words by 0.8–2.0s.

**Once it is up, something has to keep landing on the words.** After the reveals
resolve:

| rule | limit | what it catches |
| --- | --- | --- |
| `MAX_FIRST_REVEAL` | 2.0s | a card on screen saying nothing while he talks |
| `MAX_REVEAL_GAP` | 6.5s | a gap between reveals, or after the last one |

The 6.5s is a judgement, not a measurement, and worth stating as one: at 5s it
fires on stretches where the speaker genuinely spends six seconds on one idea,
which is not a fault. Past about six and a half a static graphic reads as
forgotten. The card is never actually motionless — the ground drifts and the
content rises for its whole life — so this rule is about INFORMATION arriving,
not movement.

Fixing the warnings is a plan edit, not a threshold edit. On ep.01 the cadence
rules turned `b09` from a two-item list with a 6.2s dead gap into three items
tracking his actual sentence (touchscreen → the rise of AI → voice), and moved
`b14` and `b24` to start on the words their first reveal lights.

### A shorter cut for a platform with a length cap

YouTube Shorts caps at 3:00; ep.01 runs 3:19.5. The cut is made in the CLEANER,
not in the finished video, so the plan re-resolves against it:

```bash
node ../../bin/aroll-clean.mjs --apply --cuts work/cuts.shorts.json      --suffix .shorts --out out/01_aroll_shorts.mp4
```

`--suffix` writes `work/keep.shorts.json` and `work/transcript.clean.shorts.json`
so the master's clean transcript — which every plan's phrase anchors resolve
against — is untouched.

Finding the cut: map clean-timeline seconds back to source through
`work/keep.json` (`srcStart + (t - outStart)`), and **cut only at sentence
boundaries**. Ep.01's BlackBerry digression is 32s and self-contained; every cut
inside it breaks the grammar, so the whole passage goes or none of it does. The
join came out reading better than the original — "...by interacting past
interaction behavior **so I thought, I think as a human, we have five senses**".

Then the payoff of anchoring to phrases instead of timecodes: **18 of the 21
beats re-resolved against the shorter transcript with no manual re-timing.** Only
the three whose anchor words no longer exist had to be dropped by hand.

## The decisions the tools make for you (and where to override)

- **Cuts.** Fillers (um/uh/erm/hmm), stutters (a 1–3 word phrase said twice),
  pauses over 0.7 s shortened to 0.35 s, retake proposals flagged `review: true`.
  Veto anything in `work/cuts.json` (`skip: true`), add `reason: "manual"` cuts;
  a re-propose keeps both.
- **Where the words are.** Every placement in the plan is `[phrase, offset]` or
  `[phrase, offset, "start"|"end"]`, resolved against `transcript.clean.json` at
  build time. A re-cut or a new source file does not invalidate the plan.
  `at` defaults to the phrase's first word's start, `until` to its last word's
  end; the third element overrides that — `"until": ["and a button", -0.6, "start"]`
  means *stop just before that phrase begins*, which is what you want when the
  next shot is anchored to the same phrase.
- **What B-roll means.** `broll/index.json` segments carry `action`, `tags`,
  `shot`, `quality`, `usable`, `sequence`. Tags use the words the *script* would
  say. Sequences (`speaker-fit`, `factory-test-33`, `finished-trays`…) are how a
  montage stays a montage instead of four random clips.
- **One thing owns a track.** Overlapping B-roll or same-side cards resolve to
  the later item; the earlier is trimmed (or dropped under 0.5 s). Warnings say so.
- **One coral per view.** A card on screen owns the accent; the caption's
  key-word highlight falls back to weight while any card is up.
- **Baked-in footage.** If the "raw" A-roll turns out to be a prior edit,
  `work/baked-segments.json` (background-deviation scan) lists the cutaways;
  mark `keep: true` on the ones worth keeping and the builder warns about the
  rest showing through.

## Two projects, and what the second one taught the tools

`projects/nowa-august-update/` — 11 min manufacturing update. Source turned out
to be a prior edit (baked cutaways). `projects/nowa-no-touchscreen/` — 3 min
founder explainer, genuinely raw, 720p source upscaled to 1080p; it reused the
first project's `broll/index.json` verbatim (same product, same factory footage),
so the describe step cost nothing the second time. Reusing a described library
across episodes is the intended pattern: copy `broll/index.json` +
`broll/described/`.

Fixes the second project forced, all general:

- **Frame-exact start/duration pairs.** Rounding `data-start` and
  `data-duration` to 4 decimals independently drifts — 569/30 prints `18.9667`
  and 86/30 prints `2.8667`, and their sum is one ten-thousandth past the next
  clip's printed `21.8333`, which the runtime reports as overlapping clips on
  one track. `startDur()` rounds the two *endpoints* and derives the duration,
  so printed start + printed duration is exactly the next printed start.
  Every resolved time is also snapped to the frame grid before any arithmetic.
- **Caption suppression tests the whole chunk.** A chunk that starts before a
  full-frame card and ends inside it used to print over the card until its own
  clear fired ("by Daniel thank you" over the end card).
- **Zero-duration ghost words** from Whisper sitting exactly on a cut join are
  dropped from the clean transcript — their audio was just removed, so they
  would caption silence.
- **`mm` and `ah` are not fillers.** "3.5 mm" is a spec. The filler pattern is
  `um / uh / erm / hmm` only.
- **A tick list must not carry a negative.** Green check marks on "what a
  touchscreen gives you: your eyes, one finger" read as approval of the
  limitation — that content is a `callout`, not a `checklist`.
- **Thumbnail cards take a `pos` corner.** A card in the default corner covered
  the product in all three concepts; the subject is rarely centred.

## Not wired yet

- Music generation (Suno has no official API; ElevenLabs Music needs a key).
  `music-brief.md` is the hand-off; `mix-audio.mjs` takes whatever comes back.
- SFX files: cues are generated, the five sounds in `music-brief.md §SFX` are not.
- Face detection on Windows: `face-zone.mjs` is macOS Vision. The 16:9 builder
  uses a measured static face box (`plan.face`) — measure it from a contact
  sheet of the A-roll.
- A VLM in the loop for B-roll description. Today the agent reads the sheets
  (46 sheets for 27 minutes of footage, ~10 minutes of reading). An API path
  would slot in at `broll/described/*.json`.
- Automated QC beyond lint/check: caption overflow, face coverage by cards,
  repeated B-roll — the resolved plan (`build/plan.resolved.json`) has what a
  checker needs.
