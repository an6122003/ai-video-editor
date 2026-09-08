# Media library

The flow for a folder of assets you gathered yourself — screenshots, product
shots, charts, b-roll clips. Four steps: **index → describe → match → place**.

The agent-sourced path (`MEDIA-SOURCING.md`) and this one feed the same
manifest. Use both: you bring what only you have, the agent fills the gaps.

---

## 1. Index

Drop everything into `media/library/` — subfolders are fine, structure is
ignored — then:

```bash
node media-index.mjs media/library
```

Writes `media-library.json` (one entry per asset: file, kind, dimensions,
duration, size) and `media/sheets/sheet-N.jpg` — contact sheets of 16 tiles
each, so every asset can be seen at once instead of opened one at a time.

Videos appear as a frame from **40% through**, which is usually past any intro
and onto the actual content.

Two limits worth knowing. This ffmpeg has no `drawtext`, so tiles are not
stamped with their id — **position is the index**, strict row-major, 4 per row,
and the script prints the tile→id→filename mapping with each sheet. And ffmpeg
cannot rasterise SVG, so SVGs are indexed but skipped in the sheets; open those
directly.

## 2. Describe

View each sheet. For every asset fill in its entry:

```jsonc
{
  "id": 3,
  "file": "nvidia-dgx-page.png",
  "kind": "image",
  "describes": "NVIDIA DGX Spark product page — hero with the box, spec copy below",
  "keywords": ["nvidia", "dgx", "gb10", "grace blackwell", "desktop supercomputer"]
}
```

`describes` is for a human. `keywords` are what the matcher actually uses — put
in the words the **script** would use, not the words the vendor uses. If the
video says "con chip" and the asset is a Grace Blackwell die shot, `chip` is a
keyword.

## 3. Match

Line the keywords up against `transcript.json`. Two passes:

**Literal.** `node topics.mjs` already lists every named product and tool with
timestamps. Where a library keyword matches one of those, the placement time is
decided for you.

**Semantic.** This is the part a script cannot do and the reason the agent reads
the descriptions. The transcript says "một folder tài liệu PDF" and the library
has a screenshot of a document folder — no shared keyword, obvious match. The
transcript says "chạy hoàn toàn local" and the library has a terminal recording
— that is the asset that makes the claim concrete.

Then apply the doctrine from `MEDIA-SOURCING.md §0` without softening it: an
asset earns its place by **comprehension** or **attribution**. Owning a relevant
image is not a reason to place it. A library of forty assets does not mean forty
placements — on a 2.5-minute video, ten is already a lot.

## 4. Place

Add to `logos.json`. Assets that need to be *read* use the `insert` slot:

```jsonc
{ "file": "nvidia-dgx-page.png", "at": 26.4, "dur": 4.2,
  "slot": "insert", "w": 900, "h": 620,
  "note": "COMPREHENSION — 'LLM > 100 tỷ tham số' is abstract; the product page makes it concrete" }
```

| Slot | Position | Blurs footage | For |
| --- | --- | --- | --- |
| `insert` | centred on the 3/4 line (y 1440) | no | screenshots, charts, product shots — anything meant to be read |
| `center` | true frame centre | **yes** | when the asset must own the frame |
| `pip` | top-right | no | when the footage still matters more than the asset |
| `topleft` / `topcenter` / `topright` | y 300 | no | small marks and logos |
| `wall` | full frame | n/a | b-roll that owns the beat |

### Blur is compensation for occlusion

The footage only blurs when the asset **covers the speaker's face** — which is
just the `center` slot. An asset at the 3/4 line or in a top corner blocks
nothing, so blurring there is decoration, and it makes the shot look like a
mistake rather than a choice. Default is 8px on `center`, 0 everywhere else;
`blur: N` opts in anywhere, `blur: 0` opts out.

### One thing owns the lower frame

An asset and a card cannot share the 3/4 line. Stacked, they fill everything
from the caption band up past the chin and the talker disappears behind his own
graphics.

Lifting the card is **not** a fix — it just moves the collision onto the face,
which is worse: the card ends up over his eyes instead of under them. So the
builder hides any card that overlaps an `insert` or `center` window and brings
it back after. Either the image or the card, never both.

Practically this means the copy and the asset are alternatives, not layers.
If a beat needs both a headline and a screenshot, give them separate windows —
card first, then the asset — rather than trying to fit them into one.

`w` and `h` are **caps, not fixed sizes** — the asset scales to fit inside both,
keeping its aspect. Without a height cap a 9:16 clip at `w: 760` renders 1351px
tall and swallows the frame. Default height cap is 620.

### Video assets

`.mp4` / `.mov` / `.webm` work in any slot. They get framework-owned playback
and are muted, so they never fight the voiceover.

One structural rule the linter enforces: a timed `<video>` cannot sit inside a
timed wrapper — the framework cannot manage nested media and the clip renders
**frozen**. The builder handles this by giving video entries an untimed wrapper
and putting the id, the `clip` class and the timing on the `<video>` itself,
with the frame drawn on the element rather than the wrapper. If you hand-author
a video placement, keep that shape.

---

## Where this beats doing it in CapCut

The library is described once and the descriptions persist. Next video, the same
folder is already indexed — matching is the only new work. And because
placement is data, changing a time is a one-line edit and a one-second rebuild,
not a drag on a timeline.
