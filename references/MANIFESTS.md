# Manifest schemas

## logos.json

```jsonc
{
  "logos": [
    {
      "file": "gigabyte.png",   // in media/logos/. Missing -> labelled placeholder.
      "files": ["a.png","b.png"], // OR several, stacked in one slot
      "at": 4.3,                 // seconds — seed from transcript.json
      "dur": 3.2,                // seconds on screen
      "slot": "topleft",         // topleft | topcenter | topright | wall
      "w": 340,                  // width in px on the 1080x1920 stage
      "note": "why this is here" // free text, ignored by the build
    }
  ]
}
```

Real bitmaps (PNG/WebP/SVG) rendered by `<img>` on a white plate — the same
asset you would drag into CapCut, placed by data instead of by hand.
Transparent PNG is ideal; a logo with a baked-in white background also works.

Assets must be local files: a render fetches nothing at runtime.

## video.config.mjs

```js
import { CARDS } from "./cards.data.mjs";

export default {
  outDir: "build",
  videoSrc: "input-video.mp4",
  duration: 144.73,          // seconds — clamp to the real media duration
  fps: 30,
  CARDS,
  SURFACE: { "card-01": "dark", "card-02": "glass" /* ... */ },
  // Omit pipSection entirely if the video never shrinks the speaker.
  pipSection: { lift: 62.45, in: 62.55, inDur: 0.75,
                out: 91.6, outDur: 0.7, drop: 92.35 },
};
```

### Surfaces

| Value | Use |
| --- | --- |
| `white` | default — neutral evidence, specs, lists |
| `glass` | translucent — when the footage is still doing work |
| `dark` | navy + blue offset shadow — data-heavy and closing cards |
| `blue` | light blue tint — a softer alternative to white |
| `yellow` | emphasis — **once per video** |
| `band` | full-frame section (the benchmark chapter) |

### PiP section

`lift` raises the video above the cards while still full-bleed; `in` starts the
shrink, which is what *reveals* the band underneath. `out` grows it back over
the last card, and `drop` returns it below the cards. Ordering matters — a
naive shrink leaves a black stage and pops the video back over the card.

## cards.data.mjs

Exports `CARDS`, plus the `words()` / `graphemes()` splitters.

```js
{
  id: "card-01",
  start: 0.45, end: 5.45,          // seconds, from the transcript
  html: `<div class="wrap"> ... </div>`,
  anims: [ { t: 0.35, sel: "#card-01-stat", kind: "pop", d: 0.6 } ],
}
```

`t` is relative to the card's `start`. Kinds: `fadeUp`, `slideLeft`, `pop`,
`chars`, `maskLeft`, `growX`, `countUp`.

Class names the builder styles: `.kicker .title .detail .rule .chips .chip
.statrow .stat .statlabel .specline .tag .specval .revealbox .revealbig .badge
.rows .row .rownum .rowmodel .rowrole .dot .bigmetric .bignum .bigunit .bar
.barfill .barmeta .metric .metriclabel .signoff .signname .cta`
