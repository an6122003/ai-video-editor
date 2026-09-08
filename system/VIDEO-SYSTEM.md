# An À Ha — Video layer (v1.1-video)

An extension of the v1.0 web system for 9:16 talking-head video. It changes
nothing about the brand: same two fonts, same blue/yellow/navy roles, same
1px-border-plus-offset-shadow card. It adds only what a 1080×1920 frame needs
and a 1440px page never did.

Files: `tokens-video.css` (the tokens) · `gallery.html` (the visual spec — open
it) · `fonts/` + `fontfaces.css` (both brand faces, Vietnamese included).

---

## Why a video layer at all

The web system is fluid — `clamp()`, `vw`, a max width, a scroll. A video frame
is none of those. It has one fixed size, is read once at speed, and has a human
face already occupying most of it. Four things follow.

**1. Fixed pixels.** Every value is a literal pixel on a 1080×1920 stage. No
`clamp()`, no `vw`.

**2. A bigger type ramp.** The web display step tops out near 72px on a 1440px
page. Held at phone size, a 1080-wide frame reads much smaller, so every step is
re-based: display 116px, standard headline 84px, body 34px. The floors are hard
— below 30px body and 20px label, text stops surviving a 200px feed thumbnail.

**3. A face floor.** The genuinely new idea. On a talking-head clip the speaker
owns the upper frame, so `--v-face-floor` (1150px, measure per clip) marks where
overlay cards may begin. Above it is the speaker's; below it is the system's.

**4. Motion re-tiered.** The web system tiers motion by interaction — control,
component, entrance. Video has no pointer, so the same three durations keep
their values and swap jobs, plus one new tier for charts.

---

## Centre, and hold one line

This is the one place the video layer departs from the web system, and it is
deliberate.

A page left-aligns because the eye returns to a fixed left edge down a long
scroll — the indent is a rail. A video card has no scroll. It is a single beat,
on screen for three seconds, read once. There is no rail to return to, so the
card **centres**.

For the same reason a headline **holds one line**. A wrapped headline makes the
eye travel to the end of line one, jump back, and re-anchor — mid-beat, while
the speaker is still talking. That is a cost a three-second card cannot pay.

### Fit, don't wrap

The fix is not shorter copy. It is sizing the headline to the card:

```
usable      = 1080 − 2×gutter(56) − 2×padding(44)   = 880px
size        = usable ÷ (glyphs × per-glyph)
per-glyph   = 0.53  mixed case  ·  0.63  uppercase
clamp       = 38px … 84px  (uppercase caps at 76px)
```

Then `white-space: nowrap`. A long Vietnamese headline simply sets smaller — it
still reads as one confident line rather than two ragged ones. Body copy may
wrap; headlines never do.

---

## Solid or glass

Two fills, same card. The choice is per card, and it is a content question, not
a style one.

**Solid** — white, navy, or yellow. Use when the words are the whole point: a
statement, a verdict, a caveat, a dense list, a chart. The card owns the frame
for its beat.

**Glass** — `--v-glass-fill`, a darkened translucent navy with a 16px blur,
keeping the same border, radius and offset shadow. Use when what is happening on
camera still matters: a product in hand, a screen being pointed at, a gesture
that carries the line. The viewer reads the copy *and* keeps the demo.

The failure mode is picking by taste and ending up with a video that is all
glass — at which point nothing is emphasised and every card is slightly harder
to read. Solid is the default; glass is the exception you reach for when the
footage is doing work.

Note that hidden-but-staged elements still occupy their space inside a card, so
a card with a late reveal shows an empty region until that reveal lands. That is
deliberate — it avoids a layout jump mid-beat — and it reads as breathing room
on a glass card rather than a hole.

---

## PiP placement

Platform furniture decides this, not composition.

On TikTok the right action rail — profile, like, comment, share — runs roughly
**y 950–1650**, and the caption and handle occupy the **bottom ~300px**. The
bottom-right corner, which looks like the natural home for a picture-in-picture,
is therefore the single worst position: it is guaranteed to sit under the
buttons.

**Top-right clears both.** The top safe area has ended by y 250 and the rail has
not begun by y 900, which leaves a clean band. Hence `--v-pip-x: 674px`,
`--v-pip-y: 290px` for a 350×622 pill. Card content in that section then flows
*below* the pill rather than beside it.

Reels and Shorts place their furniture similarly enough that the same position
holds. If you ever cut a version for a platform without a right rail, the pill
can return to the lower third — but never assume it; check the actual overlay.

---

## Motion map

| Duration | Web job         | Video job                          | Ease           |
| -------- | --------------- | ---------------------------------- | -------------- |
| 180ms    | controls        | card exit, label swap              | out            |
| 280ms    | components      | element inside a card, emphasis    | out / spring   |
| 600ms    | large entrance  | card entrance                      | out            |
| 900ms    | —               | **video-only** — chart, count-up   | out            |

Cards enter on `translateY(30px) + opacity`, never on scale — the system arrives
by rising, not growing. Elements inside stagger 80ms apart. `--ease-spring` is
sanctioned and is what makes a stat land, but it is for emphasis only: a
sticker, a number. Never a whole card, never body copy. Exits are a flat 180ms
fade; the asymmetry is intentional — slow to arrive, quick to leave.

GSAP equivalents: `--ease-out` → `expo.out`, `--ease-spring` → `back.out(1.56)`.

---

## Hold times

Video-only, and the rule most often broken. A card must stay long enough to be
read: roughly **0.35s per word** of its longest line, floored at
`--v-hold-min` (2.5s). Past `--v-hold-restage` (8s) a card needs a second reveal
— a stat, a chart row, a list item — or it goes stale on screen.

---

## Graphs

Charts are drawn from real numbers as inline SVG or divs. No chart library, no
screenshots of charts. Two reasons: a render must be deterministic (no network,
no randomness), and a drawn chart inherits the brand — blue fills, Space Grotesk
figures, the same card it sits in.

| Chart        | Animates by                     | Tier                |
| ------------ | ------------------------------- | ------------------- |
| Bar / meter  | width 0 → value                 | 900ms               |
| Donut / ring | `stroke-dashoffset` sweep       | 900ms               |
| Line         | `stroke-dasharray` draw         | 900ms               |
| Figure       | count-up, easing out            | 900ms               |
| Ranked rows  | staggered grow                  | 80ms apart          |

Never animate a chart faster than its number counts — the eye finishes before
the value does and the figure reads as a glitch. And never a stat without its
unit and basis: `66GB` alone is a number; `66GB of 121.6GB usable` is evidence.

---

## Images

Two distinct jobs.

**Evidence** — a screenshot, product shot, or benchmark capture that proves a
claim. It gets the printed-photo frame: 10px white margin, 20px radius, offset
shadow, rotated ±1.5° so it reads as placed rather than pasted. One tape tab at
most. Only photography tilts; never rotate a text-bearing card.

**Cutouts** — the six creator PNGs in `../assets/creator-cutouts/`. One hard
video-only rule: **never place a cutout while the live face is on screen.** Two
of the same face in one frame reads as a mistake every time. Cutouts belong on
title cards, chapter breaks and outros — moments where the footage is not the
subject. In a continuous talking-head piece that often means no cutouts at all,
and that is the correct outcome.

Assets must be local files. A render fetches nothing at runtime, so download or
generate first, then reference the frozen file.

---

## Ratios

9:16 (1080×1920) is primary. For 4:5 (1080×1350), keep horizontal values and
scale vertical ones by 0.703. For 16:9, **re-flow** — move cards to a side
third; never letterbox a 9:16 layout into a wide frame. The system is layout,
not a picture.

---

## Carried over unchanged

- Space Grotesk display, Be Vietnam Pro body. **Both cover Vietnamese**, so
  headlines keep the display face even with full diacritics.
- Sentence case body; uppercase reserved for compact labels.
- 1px borders and a small offset shadow, never soft floating cards. At video
  scale the border doubles to 2px so it survives encoding.
- One dominant accent per card plus neutrals. Yellow is emphasis — spend it once
  per video. Navy carries data-heavy and closing cards; on navy the stat turns
  yellow.
- Platform colors only inside platform-specific analytics.
- Decorative shapes may cross edges; text and CTAs stay unobstructed.
