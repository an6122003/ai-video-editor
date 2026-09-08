# ai-video-editor

An automated editing pipeline for 9:16 talking-head video. Point it at a clip
and a script; it transcribes, lays out designed graphic cards on the beats, sizes
and places images, generates karaoke captions, measures where the speaker's face
is so nothing covers it, and renders — either baked with audio, or as a
transparent overlay for an NLE.

Built on [HyperFrames](https://hyperframes.heygen.com) (HTML → video). The design
layer is the An À Ha design system extended for video.

## Why

Editing a talking-head video by hand means dragging the same kinds of element
onto a timeline over and over: a headline card, a screenshot, a logo, subtitles.
Every one of those decisions is derivable from the transcript. So they are data
here, not gestures:

```
transcript.json   word-level timings          -> when a card or caption appears
cards.data.mjs    the words                   -> what a card says
logos.json        file, time, slot, size      -> where an image sits
face-zone.json    measured face rectangle     -> what graphics must not cover
```

Change a number, rebuild in under a second, look at a still in ~7s. Render once
at the end. **You never re-render to iterate** — that is the whole point.

## Layout

```
bin/
  build-video.mjs     the builder — assembles the composition. Never edited per project.
  topics.mjs          transcript -> every product/tool named, with timestamps
  media-index.mjs     an asset folder -> inventory + contact sheets to review
  face-zone.mjs       samples frames, runs face detection, writes the face rectangle
  face-detect.swift   macOS Vision face detection (ships with the OS, no installs)
  fetch-fonts.mjs     pulls the two brand faces as local woff2 subsets
system/
  tokens-video.css    the video layer: canvas, safe areas, type ramp, motion
  tokens-web.css      the parent web design system it extends
  VIDEO-SYSTEM.md     why each value is what it is
references/
  SKILL.md            the end-to-end workflow
  MEDIA-SOURCING.md   whether an image belongs at all, and where to get it
  MEDIA-LIBRARY.md    indexing and matching a folder of your own assets
  PLATFORM-FURNITURE.md  where TikTok's UI sits and what that forbids
  MANIFESTS.md        schemas for every data file
templates/            blank starting points
example/              a real project's data files, media excluded
```

## Quick start

```bash
node bin/fetch-fonts.mjs                       # once per project
node bin/face-zone.mjs input.mp4 6             # measure the face
node bin/build-video.mjs                       # < 1s
npx hyperframes preview build --background     # Studio, hot-reloads
npx hyperframes render build -o output.mp4 --fps 30
```

Three output modes off one build:

| Command | Output |
| --- | --- |
| `build-video.mjs` | everything baked, with audio |
| `build-video.mjs --overlay` | cards + assets, transparent, no audio |
| `build-video.mjs --captions-only` | captions alone, transparent |

All three are frame-aligned, so they stack in an NLE.

## The rules that make it look edited

Most of this repo is judgement encoded as constraints. The load-bearing ones:

**An image earns its place two ways** — comprehension (the script names
something the viewer cannot see) or attribution (a sponsor logo). Anything else
is decoration. And a logo is *not* a picture of the thing: a vendor wordmark
does not show anyone what a chip is.

**One thing owns the lower frame.** An asset and a card cannot share the ¾ line.
Stacked they fill everything from the caption band up past the chin. Lifting the
card is not a fix — it moves the collision onto the face.

**Blur is compensation for occlusion, not decoration.** The footage only softens
when an asset actually covers the face.

**The eye line is the hard limit.** A graphic across the chin is a normal
lower-third; a graphic across the eyes kills the shot. The face guard protects
the upper face absolutely and reports when it cannot.

**Headlines hold one line**, sized to fit rather than wrapped. A wrapped headline
makes the eye travel and re-anchor mid-beat.

**PiP goes top-right, never bottom-right** — on TikTok the action rail and the
caption band cover that corner on both axes.

## What is deliberately not here

- **Footage and renders.** Large, rebuildable, and not mine to publish.
- **Sourced third-party assets** — captured product shots, vendor logos, site
  screenshots. Fine to use in an editorial video under fair use; not fine to
  redistribute. `media/` is gitignored; source your own per
  `references/MEDIA-SOURCING.md`.
- **Fonts.** `bin/fetch-fonts.mjs` pulls them instead. Space Grotesk and Be
  Vietnam Pro are SIL OFL 1.1.
- **Creator cutout photography**, referenced by the design system but kept local.

## Requirements

- Node 20+, `ffmpeg` / `ffprobe`
- HyperFrames CLI (`npx hyperframes`)
- Whisper `large-v3` for non-English transcription — the `.en` models are
  English only
- macOS for the face detector (uses the system Vision framework). Everything
  else is cross-platform; without it, set the face zone by hand.

## Known limits

- `cards.data.mjs` is still hand-authored. Everything either side of it is
  scripted; generating a first-draft card set is the obvious next piece.
- Captions inherit ASR errors. Correct `transcript.json` text before a final
  render — timings stay untouched.
- The face zone is measured per clip and is not portable between videos.
- Assumes a single-speaker 9:16 source. A 16:9 or multi-speaker cut needs work.

## License

None yet — all rights reserved by default. Pick one before inviting
contributions. Note that `system/` carries brand design tokens, which you may
not want under a permissive code license.
