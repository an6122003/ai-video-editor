---
name: an-aha-video
description: Package an existing An À Ha talking-head video (Vietnamese or English) with the An À Ha design system — centred one-line headline cards, solid/glass surfaces, charts drawn from real numbers, and brand logos auto-timed from the transcript. Use for "make my talking-head video", "add graphics to this clip", "add logos", "recut with my design system". Renders 9:16 MP4 or an alpha overlay for CapCut/Premiere.
---

# An À Ha video

Turns a raw talking-head clip into a finished 9:16 video carrying the An À Ha
brand. Built on HyperFrames; the design system is the video layer of An À Ha
v1.0 (see `references/DESIGN-SYSTEM.md`).

**The whole point is a fast loop.** You never re-render to iterate: edit a data
file, rebuild in under a second, look at a still in ~7s or watch it live in
Studio. Render once at the end.

## Inputs

- A talking-head MP4 (any length; 9:16 source preferred).
- The script, if it exists — otherwise the transcript is generated.
- Optional: brand logo PNG/SVG files.

## Output

`build/output.mp4` (1080×1920, original audio preserved) and/or
`build-overlay/` rendered to MOV ProRes 4444 with alpha for an NLE.

---

## The three files you edit

Everything project-specific lives in three files. The builder is never edited.

| File | Holds |
| --- | --- |
| `cards.data.mjs` | Card content and timing — the words and when they appear |
| `video.config.mjs` | Duration, per-card surface, PiP section |
| `logos.json` | Media placements: file, time, slot, size caps |
| `media-library.json` | Your asset folder, indexed and described (optional) |

---

## Workflow

### 1. Set up the project

```bash
mkdir -p videos/<name> && cd videos/<name>
```

Copy from this skill's `assets/`: `build-video.mjs`, `topics.mjs`, `media-index.mjs`,
`fontfaces.css`
(as `_fontfaces.css`), `fonts/`, and the two templates
(`video.config.template.mjs` → `video.config.mjs`,
`logos.template.json` → `logos.json`).

### 2. Probe and stage the footage

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate \
  -show_entries format=duration -of json "$SRC" > metadata.json
ffmpeg -y -i "$SRC" -vn -acodec libmp3lame -q:a 2 audio.mp3
# Re-encode with dense keyframes or the renderer freezes on seek. Scale to 1080 wide.
ffmpeg -y -i "$SRC" -vf "scale=1080:1920:flags=lanczos" -c:v libx264 -crf 18 \
  -g 30 -keyint_min 30 -pix_fmt yuv420p -movflags +faststart -c:a aac build/input-video.mp4
```

### 3. Transcribe

```bash
npx hyperframes transcribe audio.mp3 -d . --json --model large-v3 --language vi
```

`--model large-v3` is required for Vietnamese — the `.en` models are English
only. Writes `transcript.json`: a flat word array with `start`/`end`.

**Correct the ASR against the real script** before using it. Whisper reliably
mangles product names (`Qwen`→`WEN`, `RAG`→`Rack`, `peak`→`pick`). Edit `text`
in place; never touch the timestamps.

### 4. Write the cards

Group the transcript into beats and write `cards.data.mjs`. Card count comes
from duration × density: roughly 7s per card for data-dense speech, 12s for
reflective. Minimum 5.

Each card: `{ id, start, end, html, anims }`. The markup uses generic class
names (`.kicker .title .detail .stat .rule .chip .rows .bar .bignum`) which the
builder styles — so the same cards can be re-themed without rewriting content.

Timing comes from the transcript: a card starts when its beat starts, and each
reveal lands on the word that motivates it.

### 5. Source and place the images

**When an image earns its place.** Two jobs, and nothing else:

1. **Comprehension** — the script names something the viewer *cannot see*. A
   product that is not in frame, a chip inside the box, a model, a tool's UI, a
   company. The words alone leave a blank; the image fills it. This is the main
   job and the reason to go source anything.
2. **Attribution** — brand logos. The sponsor, the vendor, the tools being
   credited. These are obligations, not decisions.

The test for job 1: *read the line and ask whether a viewer who has never seen
the thing can picture it.* "Qwen2.5-VL-7B đọc hình ảnh trong PDF" — no, a model
is an abstraction, it needs a mark. "Nhỏ như một mini PC" — no, show the box.
"Peak memory 66GB trên 121.6GB" — yes they can, the chart already draws it.

**A logo is not a picture of the thing.** A vendor wordmark does not show
anyone what a chip or a model *is* — it is decoration wearing a comprehension
justification, and it competes with the captions for the same top band. For
anything the script names: show the actual thing (product shot, die shot, tool
UI, chart), or place nothing and let the words carry it. **Bare vendor marks are
attribution-only** — the sponsor, on the beat they are thanked. If an entry's
`note` says COMPREHENSION but the asset is a logo, the note is wrong and the
placement should be cut.

**Do not place an image when a card already carries the idea.** A stat card, a
bar, a pipeline list — those *are* the visual. Adding a logo beside them makes
two things compete for one beat and both lose. Images go where the words are
abstract and the cards are quiet.

Bias to fewer. An image every ten seconds reads as evidence; one every three
reads as a slideshow with a man in it.

**Your own library comes first.** If you have gathered assets yourself, drop
them in `media/library/` and index them before sourcing anything:

```bash
node media-index.mjs media/library   # inventory + contact sheets
```

Then view `media/sheets/sheet-*.jpg`, write a `describes` + `keywords` for each
asset in `media-library.json`, and match those against the transcript — literal
matches from `topics.mjs`, semantic ones by reading the descriptions. Full flow
in `references/MEDIA-LIBRARY.md`. Assets meant to be *read* go in the `insert`
slot; `.mp4`/`.mov`/`.webm` work in any slot with framework-owned playback.

Owning a relevant image is not a reason to place it — the two-job test below
still decides.

**What else needs an asset** — the video tells you:

```bash
node topics.mjs          # every product/tool named, with its timestamps
```

Mentions inside 4s collapse into one beat. Those timestamps are the placement
times: an asset belongs on screen when the thing is named.

**Where to get it** — full ladder in `references/MEDIA-SOURCING.md`. The first
rung handles most cases:

```bash
npx hyperframes capture "https://vendor.com/product" -o media/cap-<name> \
  --skip-vision --max-screenshots 4
```

Real headless Chrome, so it renders like a browser and gets past the
bot-blocking that 403s `curl` and plain fetch — GIGABYTE's product page refuses
both and captures fine. It downloads the page's own images, which is usually
where the clean transparent product PNG lives. Read
`extracted/asset-descriptions.md` and the contact sheets, then copy the one you
want into `media/shots/` or `media/logos/`.

If a page needs a login or an interaction, drive a local browser (Playwright /
the browser tools) and screenshot it. `curl` is the weakest option, not the
first.

**Licensing is not optional.** Official product imagery, press kits and
screenshots of software you are reviewing are published for exactly this and are
safe. Image-search results are someone's copyrighted work by default — never
place those automatically; propose with the source URL, get a human yes, then
freeze the file. Record where it came from in the entry's `note`.

**Then place it.** `logos.json` is the control surface — file, time, duration,
slot, width. Slots (`topleft`, `topcenter`, `topright`, `wall`) sit below the
250px platform chrome and clear of the PiP column. Missing files render as
labelled placeholders, so the whole edit can be laid out and timed before any
asset exists.

These are real bitmaps rendered by `<img>` — the same asset you would drag into
CapCut, placed by data instead of by hand.

### 6. Iterate — this is the part that matters

```bash
node build-video.mjs                          # < 1s
npx hyperframes preview build --background    # Studio, hot-reloads on rebuild
npx hyperframes snapshot build --at 63        # a single still, ~7s
```

Studio (`http://localhost:3002`) gives an NLE-style timeline and live canvas.
Edit → rebuild → it refreshes. **Do not render to check a change.**

### 7. Validate, then render once

```bash
npx hyperframes lint build
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes check build
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render build -o output.mp4 --fps 30
```

Both gates must pass first. A 2.5-minute video takes 6–12 minutes to render.

For an NLE overlay instead: `node build-video.mjs --overlay`, then render
`--format mov` (ProRes 4444, alpha, ~3.7GB for 2.5 min — needs ~12GB free).
The overlay carries no audio, so it will not double the voice on the timeline.

**Clear the cache after every render** — each one leaves several GB:

```bash
rm -rf work-*-* /var/folders/*/T/hyperframes-extract-cache-$UID
```

---

## Design rules that are not negotiable

Full spec in `references/DESIGN-SYSTEM.md`; the ones most often broken:

- **Centre, one line.** Headlines are fitted to the card width and never wrap.
  The builder does this automatically — do not fight it with manual sizes.
- **Solid is the default; glass is the exception.** Reach for glass when the
  footage is still doing work (product in hand, screen being pointed at). If
  everything is glass, nothing is emphasised.
- **One dominant accent per card.** Yellow is spent once per video.
- **Never a stat without its basis.** `66GB` is a number; `66GB of 121.6GB
  usable` is evidence.
- **Never a cutout while the live face is on screen.** Two of the same face in
  one frame reads as a mistake.
- **PiP goes top-right,** not bottom-right — see
  `references/PLATFORM-FURNITURE.md`.

## Traps

- Bundled skill fonts elsewhere are latin-only; **these** ship Vietnamese
  subsets. Both An À Ha faces cover Vietnamese, so headlines keep Space Grotesk.
- Split Vietnamese headlines per **word**, never per code point — the
  vietnamese subset carries combining marks and a naive split tears diacritics
  off their base letter.
- Display faces have ink boxes taller than 1em. A `line-height` under ~1.3 on a
  150px+ figure lets the glyph escape its box and collide with the label below.
- The runtime owns `visibility` on `.clip` elements. Animate opacity and
  transforms only, or lint rejects it.
- GSAP must not tween `left/top/width/height` — they snap to integer pixels and
  stutter under seek-by-frame capture. Use `x`, `y`, `scale`.
