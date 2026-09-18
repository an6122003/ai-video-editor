# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## When someone says "edit this video"

**The runbook is `AGENTS.md`. Read it before doing anything.** It is the whole
process in order — setup, scaffolding the project, transcribe, cuts, beats,
treatment, footage over MCP, the plan, build, Studio, render, mix, verify, and
the other deliverables — written for somebody who is not a video editor.

It lives there rather than here so every agent reads the same thing, and so
these two files cannot drift apart. What follows below is the deeper material:
the architecture, the design doctrine the builder enforces, and the traps.

Three things from it that are worth repeating because they are the ones most
often got wrong:

- **Show the proposed cuts before applying them** (`work/cuts.json`). It is
  their voice and their call.
- **Search the MCP library before the filesystem.** A few hundred KB of
  descriptions over 14 GB of video, filed into categories; almost every footage
  question is answerable without moving any of it. Search all categories first.
- **Do not ship a mix `verify-mix.mjs` fails**, and never render to check a
  change — rebuild takes under a second and prints a rhythm report.

## What this is

An automated editing pipeline for talking-head video, built on
[HyperFrames](https://hyperframes.heygen.com) (HTML → video). It compiles a
per-project plan into a single self-contained `build/index.html` composition
(inline CSS + a GSAP timeline); HyperFrames previews, lints and renders that HTML.

**Two builders live here, and new work uses the first:**

- **`bin/build-edit.mjs`** — the current one. Reads `edit-plan.json`, where every
  placement is anchored to a **spoken phrase**, and emits 16:9, 9:16 and a
  capped short from one plan. Everything in `AGENTS.md` refers to this.
- **`bin/build-video.mjs`** — the original, still used by the older projects. Reads
  per-project **data files** (`video.config.mjs`, `cards.data.mjs`, `logos.json`)
  rather than a plan. The "Architecture" section below describes this one.

The core premise: every edit decision is derivable from the transcript, so it is
data, not a gesture. **Never render to check a change** — edit a data file,
rebuild in <1s, look at a still (~7s) or watch it in Studio. Render once at the end.

## Commands

```bash
npm install                          # hyperframes 0.7.109 — the pin matters (see below)
npm run fonts                        # once per project: fonts/ + _fontfaces.css
npm run face-zone -- input.mp4 6     # measure the face -> face-zone.json (macOS only)
npm run topics                       # transcript.json -> named products/tools + timestamps
npm run media-index -- media/library # asset inventory + contact sheets to review
npm run build                        # -> build/index.html, <1s
npm run build:overlay                # -> build-overlay/  (alpha, no audio)
npm run build:captions               # -> build-captions/ (captions only, alpha)
npm run preview                      # HyperFrames Studio on :3002, hot-reloads on rebuild
npm run lint                         # must pass before rendering
npm run check                        # must pass before rendering
npm run render                       # 6-12 min for a 2.5-min video
```

There is no test suite. `lint` + `check` are the gates; both must pass before a render.

Single-still iteration (not an npm script):

```bash
npx hyperframes snapshot build --at 63
```

Transcription (`--model large-v3` is required for Vietnamese; `.en` models are English-only):

```bash
npx hyperframes transcribe audio.mp3 -d . --json --model large-v3 --language vi
```

Always go through the npm scripts. A bare `npx hyperframes` resolves to `latest`
(0.8.x), which was never validated against this pipeline — renderer behaviour
shifts between minors. `render`/`check` also need `PRODUCER_BROWSER_GPU_MODE=hardware`,
which the scripts set.

Clear renderer scratch after every render — each leaves several GB:
`rm -rf work-*-* /var/folders/*/T/hyperframes-extract-cache-$UID`

## Architecture

**`bin/build-video.mjs` is the builder and is never edited per project.** It
resolves `video.config.mjs` from `process.cwd()`, not relative to itself, so
project data files live in the directory you run the build from (the repo root
in this layout; `.gitignore` reflects that — `media/`, `fonts/`, `_fontfaces.css`,
`build*/` are all root-level).

Project state is these files:

| File | Holds |
| --- | --- |
| `video.config.mjs` | duration/fps, per-card `SURFACE` map, `captions`, `pipSection` |
| `cards.data.mjs` | exports `CARDS` — id, start/end, `html`, `anims` |
| `logos.json` | media placements: file, `at`, `dur`, `slot`, `w`/`h` |
| `transcript.json` | flat word array with `start`/`end` — drives captions and placement times |
| `face-zone.json` | measured face rectangle (generated; gitignored, not portable between clips) |

Schemas for all of these: `references/MANIFESTS.md`. Blank starting points in
`templates/`; a full real project's data (media excluded) in `example/`.

The builder is a single pass that emits one HTML file:

1. **GSAP compiler** (`compile()`) — turns each card's declarative `anims`
   (`fadeUp`, `slideLeft`, `pop`, `chars`, `maskLeft`, `growX`, `countUp`) into
   timeline tweens at absolute times. `t` in an anim is relative to the card's `start`.
2. **Headline fitting** (`fitSize()`/`oneLine()`) — rewrites `.title`/`.detail`
   with a computed `font-size` from measured card width so headlines hold one
   line and never wrap. Do not fight this with manual sizes.
3. **Face guard** — reads `face-zone.json`, derives an eye line at 45% of the
   face band, nudges `insert` assets and captions to clear it, and **logs when it
   cannot** rather than silently covering the speaker.
4. **Asset placement** — `logos.json` entries become positioned hosts in named
   slots. Missing files render as labelled placeholders, so a whole edit can be
   laid out and timed before any asset exists. `.mp4/.mov/.webm` entries get
   framework-owned playback via `data-start`/`data-duration` and skip the timed
   wrapper (a wrapper frame would outlive the clip).
5. **Derived tweens** — `yieldTweens` hides a card for the duration of an
   overlapping `insert`/`center` asset; `focusTweens` blurs the footage only
   where an asset actually occludes the face; captions auto-suppress under
   `topcenter`/`center`/`wall` or multi-file entries.
6. **Captions** — word timings chunk into 1-3 word groups (on word count,
   terminal punctuation, or a >0.35s pause) driven through **one** `#caption`
   element via `tl.set(innerHTML)`. One clip per chunk would be ~280 timed
   elements and blow the timeline-density limit.

`--overlay` and `--captions-only` are the same build with layers withheld and a
transparent stage, all frame-aligned off one source of truth so the three outputs
stack in an NLE. `config.overlayVideoSrc` can point at a trimmed clip covering
only the PiP window — it cuts the renderer's frame extraction dramatically.

Design tokens and the reasoning behind each value: `system/tokens-video.css`,
`system/tokens-web.css`, `system/VIDEO-SYSTEM.md` (byte-identical to
`references/DESIGN-SYSTEM.md` — edit both or neither).

## The B-roll library (read this before hunting for footage)

Described footage lives at **https://cyrusstudio.space/broll/**, and it speaks
MCP at `https://cyrusstudio.space/api/broll/mcp` (bearer token, ask the owner or
copy the brief from the site's *Connect an agent* view).

**If the MCP server is connected, use it before touching the filesystem.** The
catalogue is a few hundred KB of written descriptions over 14 GB of video, filed
into categories (the factory, the product in use). Nearly every
footage question — *"do we have a shot of the speaker grille?"*, *"what covers
assembly?"* — is answerable from `search_broll` alone, and answering it by
downloading video is the main way to waste an hour and a lot of bandwidth.

- **Search with a natural phrase, not a keyword.** Results are RANKED by how many
  terms match, so a fuller description sorts better and never returns less.
  `"worker tightening a screw on the circuit board"` beats `"screw"`.
- **Never search filenames.** A camera calls everything `DJI_0004`; the entire
  value of the describe pass is that a human wrote down what is happening.
- **A result is a SHOT, not a clip.** A 39-second take usually holds four. Each
  row carries `clip`, `start`, `end` — that in/out is what a plan cuts against,
  and the file is longer than the shot.
- **Only call `get_broll_clip` when you need the file itself.** It returns URLs;
  they accept HTTP `Range`, so take the seconds you need, not 271 MB.
- **An empty search is not proof of absence.** Call `broll_facets` for the shot
  types, sequences and tags this library actually uses, then search those words.

Propose shots as `{clip, start, end, why}` — the shape `edit-plan.json`
references a shot by, and the same shape the library's *Copy selection* button
emits, so a human picking in the browser and an agent picking over MCP produce
interchangeable output.

**Without the MCP server**, `bin/broll-pull.mjs --remote <base>` fetches the
catalogue (≈3 MB, no video) and `broll/index.json` becomes locally searchable.
Do that rather than asking someone to send you footage.

**Your job is the recall, not the taste.** Reading 124 descriptions and
remembering what is in them is what you are good at. Deciding what the edit
should feel like is not — propose, and let the human choose.

## Doctrine that is load-bearing

These are encoded as constraints in the builder and enforced in review. Full text
in `references/SKILL.md`, `MEDIA-SOURCING.md`, `PLATFORM-FURNITURE.md`.

- **An image earns its place two ways only** — comprehension (the script names
  something the viewer cannot see) or attribution (a sponsor/vendor logo).
  Anything else is decoration. A logo is *not* a picture of the thing: a wordmark
  shows nobody what a chip is. If an entry's `note` says COMPREHENSION but the
  asset is a bare wordmark, the note is wrong and the placement should be cut.
- **Do not place an image when a card already carries the idea.** Bias to fewer:
  one image every ten seconds reads as evidence; one every three reads as a slideshow.
- **One thing owns the lower frame.** An asset and a card cannot share the ¾ line.
  Lifting the card is not a fix — it moves the collision onto the face.
- **Blur is compensation for occlusion, not decoration.** Only `center` blurs by default.
- **The eye line is the hard limit.** Chin overlap is a normal lower-third; a
  graphic across the eyes kills the shot.
- **PiP goes top-right (674, 290), never bottom-right** — on TikTok the action
  rail and caption band cover that corner on both axes.
- **Solid is the default; glass is the exception.** One dominant accent per card;
  `yellow` is spent once per video. Never a stat without its basis.
- **Licensing:** official product imagery, press kits, and screenshots of software
  being reviewed are safe. Image-search results are copyrighted by default — never
  place those automatically; propose with the source URL, get a human yes, then
  freeze the file locally and record the source in the entry's `note`.
- **Sourcing ladder:** `npx hyperframes capture <url>` (real headless Chrome) first
  — it gets past bot-blocking that 403s `curl` and plain fetch. `curl` is the
  weakest rung, not the first.

## Traps

- Correct ASR errors in `transcript.json` `text` before a final render — Whisper
  reliably mangles product names (`Qwen`→`WEN`, `RAG`→`Rack`). **Never touch the timestamps.**
- Split Vietnamese headlines per **word** (`words()` in `cards.data.mjs`), never
  per code point — the vietnamese subset carries combining marks and a naive
  split tears diacritics off their base letter. `graphemes()` is for short ASCII tokens.
- The HyperFrames runtime owns `visibility` on `.clip` elements. Animate opacity
  and transforms only, or lint rejects it.
- GSAP must not tween `left/top/width/height` — they snap to integer pixels and
  stutter under seek-by-frame capture. Use `x`, `y`, `scale`.
- No CSS animations or `repeat` — a seek to an arbitrary frame must land on the
  right state, so every motion is a one-shot tween on the timeline.
- Re-encode source footage with dense keyframes (`-g 30 -keyint_min 30`) or the
  renderer freezes on seek.
- A key file written on Windows is probably NOT UTF-8. PowerShell's `>` and
  `Out-File` produce UTF-16LE with a BOM, so `readFileSync(path, "utf8")` yields
  `�S\0E\0R\0P...` and the key silently never matches. `image-search.mjs`
  sniffs the BOM and falls back to an interleaved-NUL test; do the same anywhere
  else that reads a hand-made config file. It also rejects obvious placeholders
  (`your_key_here`) with a message, because "no key" and "the example text" are
  different problems and look identical otherwise.
- A full-frame card needs an OPAQUE face. `.pxcard .face` paints its 2px rim in
  `--pxborder`, which for night is `rgba(255,255,255,.14)` — right for a card
  floating on footage, wrong for a surface that *is* the frame, where the rim
  becomes a 2px window down both edges showing whatever is behind. Any layout the
  CSS promotes to the whole frame belongs in the flat-face rule; that is how
  `bignum:hero`/`:split` got there, being full-frame by CSS rather than by
  `FULL_FRAME`. It leaked an A-roll sliver in 16:9 unnoticed, then the bright
  parchment ground the moment portrait existed — found by sampling single pixels
  at x=0 and x=W-1, not by looking at the frame.
- Display faces have ink boxes taller than 1em; `line-height` under ~1.3 on a
  150px+ figure lets the glyph escape and collide with the label below.
- `backdrop-filter` cannot work on the alpha path (nothing behind to sample, and
  it times out `Page.captureScreenshot`) — `glass` falls back to a denser flat fill
  when `OVERLAY` is set.
- `face-zone.mjs` needs macOS (system Vision framework via `bin/face-detect.swift`).
  Everything else is cross-platform; without it, set the face zone by hand.
- `example/storyboard.json` is not read by anything in this pipeline — it is a
  leftover from an earlier storyboard-based flow. `example/metadata.json` is raw
  `ffprobe` output.

## The 16:9 pipeline (2026-09, `PIPELINE.md`)

A second toolchain sits beside the original 9:16 builder and shares nothing
with it but HyperFrames and `fetch-fonts.mjs`. It runs per project from
`projects/<name>/` (cwd = project dir; `project.json` holds source paths):

| Step | Tool | Writes |
| --- | --- | --- |
| transcribe | `.venv/Scripts/python bin/transcribe.py <src> --out work` (faster-whisper, CUDA) | `work/transcript*.json`, `.srt` |
| clean A-roll | `bin/aroll-clean.mjs` (propose) → review `work/cuts.json` → `--apply` | `out/01_aroll_clean.mp4`, `work/transcript.clean.json`, `work/keep.json` |
| beats | `bin/beats.mjs` | `work/beats.json` |
| B-roll library | `bin/broll-index.mjs <folder> --out broll` → read sheets → `broll/described/*.json` → re-run | `broll/index.json`, `broll/sheets/` |
| compose | `bin/build-edit.mjs` (reads `edit-plan.json`) | `build/index.html`, `build/broll/*.mp4`, `build/plan.resolved.json` |
| sound | `bin/sfx-cues.mjs`, `bin/mix-audio.mjs` | `sfx-cues.json`, `out/final.mp4` |
| treatment | `bin/treatment.mjs --own "Daniel"` | `work/treatment.json` — what every beat wants, and the searches to run |
| verify mix | `bin/verify-mix.mjs --video out/02_edit.mp4 --music <mp3>` | prints the voice/bed separation; exit 1 if it fails |
| vertical | `bin/build-edit.mjs --plan edit-plan.9x16.json` | `build-9x16/` at 1080x1920 from the SAME master plan |
| a shorter cut | `bin/aroll-clean.mjs --apply --cuts work/cuts.shorts.json --suffix .shorts --out out/01_aroll_shorts.mp4` | a variant A-roll + transcript, master untouched |
| thumbnails | `bin/thumbnails.mjs` (reads `thumbnails.json`) | `thumbs/out/*.png` |

Things about it that are not obvious from the code:

- **One plan, several frames.** The composition belongs to the DELIVERABLE, not
  the project: `plan.composition` (or `--composition WxH`) overrides
  `project.composition`, and a plan may `extends` another, overriding top-level
  keys and patching beats by id through `beatOverrides` (`"b12": null` drops
  one). The chain resolves base-first and throws on an id that is not in it. Ep.01
  ships 16:9, 9:16 and a Shorts-length 9:16 from one `edit-plan.json`.
- **Portrait is not landscape with different numbers.** `VERT` (H > W) changes
  real rules, all of them in `PIPELINE.md` §"Vertical, from the same edit".
- **`plan.arollFit` decides how the talking head is shown, and `"full"` is the
  default** — cropped to the speaker, filling the frame, cards overlaid: what a
  vertical feed expects. On a small source that costs an upscale (ep.01's A-roll
  is 1280x720, so a 9:16 crop is 405x720 real pixels at **2.67x**) and the answer
  is not to avoid it but not to waste it: the builder crops and rescales the
  A-roll itself with lanczos + unsharp instead of letting the renderer stretch a
  video element bilinearly. Measured on a face crop that is **+68% edge energy**,
  with no halo ringing. `"band"` is the sharper opt-in — footage at 1:1 in a
  window, cards in the room underneath, plus `plan.rail`/`plan.standing` to fill
  that room — but it gives up the full-frame look. Ep.01 ships full-bleed.
- **Portrait splits the frame in three and he owns the middle.** The caption
  goes ABOVE his head (bottom edge 16px clear of the mapped face box), cards go
  in the band UNDER his chin, and `BOT_SAFE` keeps them out of the bottom 20%
  where TikTok and Reels draw their own username and buttons. Nothing crosses
  his face, so the face guard becomes a backstop instead of the mechanism.
  `plan.captionPos: "bottom"` restores the landscape habit.
- **A vertical card is not a landscape card resized.** Scaling the landscape
  sheet to ~0.65 is what produced "weirdly empty and out of proportional":
  display type has to be set against the frame's WIDTH (~968px of measure), so a
  statement line is **150px** not 88, a hero numeral **660px** not 380. Two traps
  come straight back out of that: `statement:blocks` sizes its own `.stb span`
  and misses the line size, and a numeral that big needs `line-height: 1.18` or
  Onest's ink box collides with the eyebrow above and the label below. Panels are
  the opposite problem and stay compact.
- **A picture earns more room than a panel.** Text panels sit below his chin
  (`ZONE`); a `plate` gets `ZONE_PIC`, which starts just under the EYE line,
  because a photograph needs the height and a graphic across the jaw is an
  ordinary lower third. `plate` has its own positioning branch — it centred the
  card in the frame and put it over his eyes the moment the picture got big
  enough, so that branch is zone-aware too.
- **`plate:slides` is an image slideshow**: several pictures in one frame, each
  arriving on the phrase that calls for it, each carrying its own source chip,
  cross-faded with one-shot tweens so a seek lands on exactly one slide. Slides
  share a box so they use `object-fit: contain` and letterbox on the mount.
  A slideshow is exempt from the reveal-or-shorten rule, like a video scene.
  **This is where a card may become a different TYPE per format** — ep.01's
  wheel/ball/pad story is a `timeline:track` in 16:9 and a slideshow in vertical.
- **B-roll `fit`:** `cover` (crop, the default), `whole` (fit the width, blurred
  fill above and below), `pillar` (the transpose). A 9:16 crop of a 16:9 shot
  keeps 31.6% of its width — right for a detail, wrong for a product macro. The
  blurred fill is a ZOOMED centre of the same frame; a straight crop inherits the
  source's composition and gave a black void above and a readable close-up below.
- **Everything else about portrait follows:** side-by-side layouts stack (`VERT_LAYOUT`),
  `list:panel` loses its full-height column, panels get a white card face back,
  captions become an ink chip rather than white-on-scrim, display type scales
  down while body type scales UP, every cutaway is full-bleed, and the face box
  is re-mapped through the crop — which caught a panel on his eyes on the first
  full-bleed build.
- **Cut a shorter version in the CLEANER, never in the finished video.**
  `aroll-clean.mjs --suffix .shorts` writes `work/transcript.clean.shorts.json`
  beside the master's, so the phrase anchors of every other plan survive; then the
  short plan just points `aroll`/`transcript` at the variant. Cut only at sentence
  boundaries (map clean seconds back to source via `work/keep.json`). On ep.01,
  **18 of 21 beats re-resolved with no manual re-timing** — that is the whole
  reason placements are phrases and not timecodes.
- **A graphic may not get ahead of the script.** Two rules, because it is two
  faults: `MAX_LEAD` (0.6s) clamps a placement anchored to arrive before its own
  words, and the cadence pair — `MAX_FIRST_REVEAL` (2.0s) and `MAX_REVEAL_GAP`
  (6.5s) — catches a card that lands and then holds still. The 6.5s is a stated
  judgement, not a measurement: 5s fires on speech that genuinely dwells, and
  the card is never motionless anyway (the ground drifts, the content rises), so
  the rule is about INFORMATION arriving. **Fix the plan, not the threshold** —
  on ep.01 they turned a two-item list with a 6.2s dead gap into three items
  tracking his actual sentence, and moved two cards to start on the words their
  first reveal lights.
- **`bin/image-search.mjs` has four providers in two kinds.** Openverse and
  Wikimedia are licence-filtered libraries. **serper.dev and SerpAPI are Google
  Images** — different services, different keys, both returning no licence at
  all, so their results carry `license: "unverified"` and a credit chip naming
  the domain. Whether that is enough for a given video is the owner's call; the
  builder refuses anything not `approved` in `media/sources.json`, so the
  decision is explicit and recorded either way. Keys come from a flag, the
  environment, or `.serpapi-key` / `.env.local` / `.env` in the repo root (all
  gitignored) — never a tracked file. The lookup reports which NAME it found the
  key under, because a key for the wrong service returns a bare 401 and is
  indistinguishable from a typo.
- **Classify the script BEFORE searching.** `bin/treatment.mjs` reads the beats
  and marks each PICTURE / FOOTAGE / GRAPHIC / NONE, and emits the search list.
  Skipping it is how ep.01's first pass ended up with four images across 3:19 —
  one subject searched because it happened to come to mind. Two things make it
  work rather than produce noise: the footage match is against an explicit list
  of **things you can point a camera at** (matching any shared word made
  "through" and "fun" into evidence, and all 25 beats came back FOOTAGE), and a
  query is built from **the phrase the thing sits in**, because bare "album"
  searches for record sleeves. `--own` marks our own names or it proposes
  searching for "daniel toy".
- **`plate:full` carries nothing but the picture and a `Source:` chip.** No
  frame, no eyebrow, no caption — and it does NOT inherit the manifest's
  caption, which is a convenience for the framed layouts. `object-fit: cover`,
  not `contain`; contain letterboxes it into a band and produces exactly the
  "single image just sitting there" look the layout exists to avoid.
- **A short full-bleed still is a cutaway, not full-frame.** The 25% cap is
  about walls of TYPE taking the screen from the speaker; a 3s photograph is a
  B-roll cut. `isPictureCut()` counts it with the cutaways and reports it
  separately, so adding the pictures the script calls for does not trip a rule
  written about something else.
- **Google is useful as a lookup even when its pictures are not usable.** It
  names the thing you are looking for (model numbers, product names); searching
  the licensed libraries for those names is how an unusable result becomes a
  licensed one. Do that before widening.
- **Plan times are phrases.** `edit-plan.json` anchors every placement to
  `[spoken phrase, offset]` — or `[phrase, offset, "start"|"end"]` to override
  which edge of the phrase is meant — resolved against `transcript.clean.json`
  at build time, so a re-cut or a re-supplied source does not invalidate the
  plan. Numeric `start`/`end` on a beat are only the hint for disambiguating
  repeated phrases.
- **Emitted times must be frame-exact as printed strings.** `startDur()` rounds
  the two endpoints and derives the duration; rounding start and duration
  independently drifts by 1e-4 and the runtime reads that as overlapping clips
  on one track. Don't reintroduce `data-duration="${q(dur)}"`.
- **The builder must ship GSAP** (`build/vendor/gsap.min.js` from
  `node_modules/gsap`). Without it the timeline script throws on load and every
  card is invisible while lint still passes — validate with `hyperframes check`.
- **Tweens go on the inner wrapper, never on the `.clip` host**, and every exit
  is followed by a `tl.set(..., {opacity:0})` hard kill at the clip end — lint
  rejects anything else (`gsap_exit_missing_hard_kill`). Timed `<video>`
  elements need an `id` or they render frozen.
- **B-roll windows are cut from the 4K source** into `build/broll/` at
  composition size with a 0.4 s handle (`data-media-start`), cached by
  `clip+in+dur+fit`. Portrait clips use `fit: "pillar"`.
- **Overlaps resolve to the later item** (B-roll on one track, cards per side);
  the earlier is trimmed or dropped under 0.5 s, with a warning.
- **The "raw" A-roll for `nowa-august-update` is a prior edit** with cutaways
  and two roadmap text cards baked in. `work/baked-segments.json` lists them
  (`keep: true` = worth leaving); the builder warns when a non-kept one shows
  through. If the true camera file arrives, re-run transcribe → clean → beats.
- **The rhythm rules are enforced, not advisory** (full table in `PIPELINE.md`).
  Cutaway floors 3.2s full-frame / 2.2s inset — short shots are auto-extended
  into available room or dropped. Every build prints coverage, shot lengths, the
  card-type histogram and the longest bare stretch, and warns past: 20s in one
  unbroken talking-head stretch, 50% bare overall, 34% share for any one card
  type, 2 of a type in a row. Override per project under `plan.rhythm`.
- **Balance full-frame against panels.** A full-frame card removes the speaker;
  the build warns past **25% of runtime** and when two full-frame cards sit
  **within 3s** of each other. Reach for `list:panel`, `checklist:rows`,
  `callout:*`, `bignum:panel` to keep him on screen.
- **No still frames.** A card held over **8s** with no `reveal` anchors is
  flagged (`quote`, `cells` and video scenes exempt). Every full-frame surface
  also drifts its ground for the card's life, stills push in slowly, and the
  `.el` stagger spreads across the hold — all one-shot linear tweens, because a
  looped CSS animation would not survive a seek.
- **A reveal must land inside the card, and nothing else may fight it.** Three
  rules, each of which has already cost a silently-broken card:
  1. Select the revealed item by **`data-i`, never `:nth-child`** — a compare has
     seams between its columns and a track has a rail among its stops, so
     positional selectors address the wrong element or nothing at all.
  2. The generic `.el` entrance stagger must **skip whatever the reveal owns**
     (`revealOwns()` → `.el:not(.lp-row)` and friends). Every row element also
     carries `el`, so the stagger's `opacity:1` at `at+0.12` was undoing the
     reveal's arming `opacity:0` at `at`: the items all arrived with the card and
     then sat still — precisely the failure reveals exist to prevent, and it was
     live on every `list` and `checklist` card in every episode.
  3. A phrase spoken **before** the card's own start resolves to a negative
     offset. `at` moves later during overlap resolution and the face guard, so
     this happens by accident; the item would fire before the arming set and then
     never come back. Offsets are clamped into the card's life and a `REVEAL`
     warning names the beat — fix the plan, do not live with the clamp.
- **A card has two axes:** `type` = what the data is, `layout` = how it looks.
  **52 `type:layout` pairs across 14 types** (the gallery shows 58 cards — it
  renders each of `annotate`'s four mark shapes separately) — run `node ../../bin/layouts.mjs` from a
  project to get `layouts/index.html`, a browsable page of every one at true
  1920x1080 over that project's footage, with day/night and backdrop toggles and
  click-to-copy JSON. It extracts the renderers and the CSS from
  `bin/build-edit.mjs` at run time, so it cannot drift; if it errors, the
  extraction regexes are CRLF-sensitive (this file has mixed line endings).
  Variety warnings count `type:layout` pairs, so reach for a different layout
  before inventing a type.
- **No panel may cover the speaker's eyes.** The builder checks each panel's
  footprint against `plan.face` and *moves the card* (other side → low band →
  high band), warning only if nothing clears. It protects the **upper 60%** of
  the face box, not the chin — a graphic across the jaw is a normal lower-third.
  Panels wider than 55% of the frame centre and drop below the face. Escape
  hatches: `x`, `v`, `centre`, `ignoreFace`.
- **The B-roll index has a viewer/editor:** `node ../../bin/broll-review.mjs` →
  `broll/review.html`, a thumbnail per segment beside its editable fields, with
  a Download-corrections button that emits the `described/*.json` shape. It
  never writes to disk; fold corrections back in via `broll-index.mjs`.
- **Image sourcing reality:** Google blocks automated browsers with a CAPTCHA
  (do not work around it), and other engines return rights-reserved product and
  Pinterest listings. Use `bin/image-search.mjs` (Openverse + Wikimedia,
  commercial-use licences) — it is the only path that ends in a usable file.
- **`plate` scenes** (`hero` `duo` `trio` `quad` `wide`) are the full-frame
  picture layouts: copy in ink/coral blocks left, 1–4 framed slots right. A slot
  takes a sourced still (`{file}`, approval-gated, gets a `Source:` chip from the
  manifest) **or one of our own B-roll clips** (`{clip, in, dur}`, no gate, no
  chip — it is ours); mixing them is fine. Pass them as `media: [...]`.
  Scene clips are cut at 1280x720 into `build/broll/scene-*.mp4` and played as
  timed media, **each slot on its own track** — slots in a scene are
  simultaneous, and the runtime rejects overlapping clips on one track.
- **`plate` cards carry someone else's picture.** `bin/image-search.mjs` proposes
  (Openverse + Wikimedia, commercial-use licences only); a human approves in
  `media/sources.json`; the builder **refuses** anything unapproved and builds the
  credit line from the manifest, not the plan. A licence on a photograph is not
  permission for what it depicts — that judgement stays human.
- **The card kit is eleven presentations in three registers**, and using one for
  everything is a build warning. Panels (`lower-third` `bignum` `process`
  `checklist` `callout` `timeline`) take `side` **and `v`: top|mid|bottom**.
  Full-frame (`statement` `list` `compare` `quote` `endcard`) take
  `over:"footage"` for a scrim instead of a fill. No-text (`annotate` `cells`)
  draw straight onto the footage. Entrances: `rise` `plant` `fade` `wipe`
  `dither`. Before adding a twelfth type, check the histogram — the usual
  problem is reaching for `callout` again.
- **The mix is verified, not eyeballed.** `bin/verify-mix.mjs` rebuilds the bed
  from `bin/lib/bed.mjs` — the same module the mixer uses, so it cannot measure a
  mix nobody shipped — and reports the voice and the bed in LUFS over the
  **speech windows derived from `transcript.clean.json`**. Target **10-20 LU of
  separation**; below that the music covers the voice, above it there is no point
  having music. It also renders the bed with the duck bypassed, because a
  talking-head video is ~96% speech and has no pauses long enough to measure the
  duck against — an earlier version reported the duck as exactly `0.0 LU` because
  the only "pause" it found was inside the outro fade.
- **Three sound-mix traps, all found by measuring:**
  - `alimiter` defaults to `level=enabled`, which **auto-normalises back toward
    0 dBFS** and undoes `loudnorm` entirely — lowering the ceiling made the file
    *louder*. Always `level=disabled`.
  - Single-pass `loudnorm` applies a **time-varying** gain, so it holds the
    programme at −14 on average while quietly modulating the voice-to-bed
    balance. The mixer measures first and applies `linear=true`: one static gain,
    so the separation that was verified is the separation that ships.
  - A library track fades in and out, so `-stream_loop` puts a **hole in the
    middle of the edit** (`Cosy - Dyalla` is 141s under a 200s video: silence at
    2:21). `bedGraph()` lays down as many copies as needed and joins them with
    `acrossfade`, summing the falling ramp against the rising one.
  - `sidechaincompress` at `ratio=8` over 96% speech never releases: the bed was
    pinned 25 LU down and inaudible. Default is now `4:1`, and the **level is set
    with `--music-db`** against the measured result, not guessed.
- **Green ticks assert approval.** A `checklist` must carry a positive list;
  a limitation or a criticism is a `callout` or a `statement`.
- **Third-party IP: characters stay in type, products may be shown.** Ep.02
  discusses Pokémon and Groot and shows neither — a character's artwork is the
  whole asset. Ep.01 shows photographs of BlackBerry hardware, credited, because
  the argument is about that hardware and you cannot make it without the object.
  Both calls are the owner's, recorded per image in `media/sources.json`.
- **Nowa brand rules the builder enforces:** stepped `clip-path` corners on
  every drawn surface, hard offset `drop-shadow` (never blur), Onest headings /
  Noto Sans body / Tiny5 only for the eyebrow, one coral per view (a visible
  card owns it; the caption highlight falls back to weight), day/night card
  rhythm, expo-out `translateY + opacity` entrances with exits at ~75%.
- **Windows specifics:** no Swift, so `face-zone.mjs` does not run — the 16:9
  builder uses a static face box (`plan.face`). `hyperframes transcribe` needs
  whisper.cpp, which is why `transcribe.py` exists. Chrome for rendering:
  `npx hyperframes browser ensure`. Frames cache: `%TEMP%\hyperframes-extract-cache-u`.

## Known limits

- `cards.data.mjs` is still hand-authored — everything either side of it is scripted.
- Assumes a single-speaker 9:16 source; 16:9 or multi-speaker needs work.
- `references/CAPCUT-FORMAT.md` is reverse-engineered from CapCut 9.3.0 (macOS),
  `draft_content.json` version `360000` — undocumented and version-specific.
  Re-verify against a live draft after any CapCut update.
