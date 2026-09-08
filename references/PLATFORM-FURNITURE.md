# Platform furniture

Where the platform's own UI sits, and what it means for layout. Measured on a
1080×1920 stage.

## TikTok (primary)

| Region | Extent | What lives there |
| --- | --- | --- |
| Top chrome | y 0–250 | search, following/for-you tabs |
| Right action rail | x 900–1080, y 950–1650 | profile, like, comment, share, sound |
| Caption + handle | y 1620–1920 | @handle, caption text, music ticker |

Reels and Shorts place their furniture close enough that the same layout holds.
These coordinates shift with app versions and phone aspect ratios — treat them
as a working estimate, and check a real device before a launch that matters.

## Consequences

**Cards** sit in the lower stage — below the face floor, above the caption band.
`bottom: 310px` clears the handle and caption.

**PiP goes top-right, never bottom-right.** Bottom-right looks like the natural
home for a picture-in-picture and is the one position covered on both axes at
once — the rail crosses it horizontally and the caption crosses it vertically.
Top-right at `674, 290` is clear: the top chrome has ended by 250 and the rail
has not begun by 900.

When the PiP is up, section content flows *below* the pill rather than beside
it. That leaves the mid-frame emptier than a bottom-right layout would — the
trade is legibility on a real phone against density in the editor.

**Logo slots** all sit in the top row (y 300) for the same reason: it is the
only band that is simultaneously below the chrome, above the face, and clear of
the rail.

## The face floor

Not platform furniture but the same kind of constraint. On a talking-head clip
the speaker's head and shoulders own the upper frame; `--v-face-floor` (1150px
default) marks where cards may begin. Measure it per clip — a wide shot lets
cards sit higher, a tight one pushes them down.
