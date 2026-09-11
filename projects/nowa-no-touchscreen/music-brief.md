# Music brief — Little Thing of Nowa, ep. 01 (no touchscreen)

For Suno / ElevenLabs Music / a composer. Output to `music/bed.mp3`;
`bin/mix-audio.mjs` loops it to length, ducks it under the voice and normalises
to −14 LUFS, so it does not need to be cut to picture.

## What the video is

3 min 19 s. The founder explains one design decision: the device has a physical
screen, a scroll wheel and a button — no touch. The argument runs: kids will
learn touch anyway → the fun physical interactions are being lost → the wheel
came from his first BlackBerry → we have five senses and touch uses one → a
button gives you many kinds of feedback → we could have made a glass slab and
it would have been boring.

The register is a person thinking out loud, fond of old hardware. Not a product
ad. Nothing triumphant.

## Mood arc

```
0:00–0:30   curious, matter-of-fact     (the question, what the device has)
0:30–1:15   wry, a little rueful        (the TikTok kid, "funny and sad")
1:15–2:00   warm nostalgia              (the BlackBerry wheel)
2:00–2:45   thoughtful, building        (five senses, touch vs. a button)
2:45–3:19   settled, quietly convinced  (the way a toy should be)
```

One bed the whole way — the ducking supplies the dynamics. No section changes
the ear can point at.

## Sound

- **Genre:** warm lo-fi electronic, close to a design-documentary bed. Plucked
  or muted synth, soft tape-ish keys, warm sub bass, light vinyl/room noise.
  A restrained 8-bit blip is on-brand as texture (pet-world seasoning, low in
  the mix) — never a chiptune melody.
- **Tempo:** 88–96 BPM. Slower than the August update; this one is reflective.
- **Key:** major with a wistful lean — F, Bb, or a Lydian colour.
- **Dynamics:** quiet and even. It sits −16 dB under dialogue.
- **Length:** 2–3 minutes, loopable, ends on the chord it starts on.

## Avoid

- Vocals, choirs, whistling.
- Trailer drums, risers, drops, big reverb swells.
- Corporate ukulele, hand claps, "explainer video" marimba.
- Kids'-TV brightness — the audience is the parents.
- Any nostalgia cliché that names the era (no 8-bit arcade pastiche, no
  dial-up/modem sounds) — the BlackBerry beat is warm, not a gag.

## Prompt (paste-ready)

> Warm lo-fi electronic underscore, 92 BPM, major key with a wistful lean,
> muted plucked synth and soft tape keys over warm sub bass, faint vinyl room
> noise, one subtle 8-bit blip as texture low in the mix, calm and reflective,
> no vocals, no drum fills, no risers or drops, loopable, background music for a
> founder explaining a design decision to camera.

## What was actually used (2026-09-09)

No commissioned bed yet, so the second pass uses a track from
`H:/backup/DJI/Music`: **`Cosy - Dyalla`** (141s, −13.5 LUFS). It matches the
brief closely — warm lo-fi electronic, unhurried, major with a wistful lean, no
drums to speak of. It is a YouTube Audio Library download (the only tag on the
file is `encoder=Google`).

```bash
node ../../bin/mix-audio.mjs  --video out/02_edit.mp4 --music "H:/backup/DJI/Music/Cosy - Dyalla.mp3"                               --music-db -9 --sfx sfx-cues.json --out out/final.mp4
node ../../bin/verify-mix.mjs --video out/02_edit.mp4 --music "H:/backup/DJI/Music/Cosy - Dyalla.mp3" --music-db -9
```

Measured on the shipped mix (`bin/verify-mix.mjs`, speech windows from
`work/transcript.clean.json`):

| | |
| --- | --- |
| voice, while speaking | −15.9 LUFS |
| music, undacked | −22.6 LUFS |
| music, while he speaks | −30.9 LUFS |
| **separation over speech** | **15.0 LU** |
| duck gain reduction | 8.3 LU |
| delivered programme | −14.5 LUFS, −1.2 dBTP, LRA 4.7 |

15 LU errs deliberately quiet — the brief for this pass was that the voice must
not be covered. If the bed should be more present, `--music-db -12` lands near
12 LU, which is the loud end of normal for a bed under narration.

The track is 141s under a 200s video, so it plays **twice, crossfaded over 6s**
(`bin/lib/bed.mjs`). It fades out at the end — the last 5s measure −37.7 dB RMS
against −13.8 for the whole track — so a plain loop would have dropped the bed
to silence at 2:21 and faded it back in.

**Not verified:** whether the track is entirely instrumental. Spectral analysis
was inconclusive and nothing can substitute for listening to it, so the choice
needs a human ear before publishing. `Pienso Viento - Casa Rosa` (157s, −14.4)
and `June time - Patrick Patrikios` (157s, −14.8) are the next-closest matches
in the folder if this one turns out to have a vocal.

**No SFX in the mix.** `sfx-cues.json` holds 17 placed cues but `sfx/` is empty,
and the mixer skips a cue whose file is missing.

## SFX

Cues generate from the edit (`node ../../bin/sfx-cues.mjs`) into
`sfx-cues.json`; drop these into `sfx/` and the mixer picks them up. Budget is
enforced — one noticeable hit per 6 seconds at most.

| file | used for | character |
| --- | --- | --- |
| `impact-soft.wav` | a card landing | short, soft, low thud — felt, not heard |
| `tick.wav` | the count-up on "5 senses" | tiny UI tick, pixel-ish |
| `whoosh.wav` | cut to full-frame B-roll | short air movement, no tail |
| `click.wav` | (unused in this episode — no process card) | dry mechanical click |
| `chime.wav` | end card | two-note pixel chime, warm |

**Worth adding by hand for this episode:** a single soft *scroll-wheel detent*
click under the 20 s and 116 s wheel macros, and a *button press* under the
150–160 s stretch. The whole video is an argument about how physical controls
sound — hearing one, once, is worth more than any card.
