# Music brief — Nowa August update

Feed this to Suno / ElevenLabs Music / a composer. Output goes to `music/bed.mp3`;
`bin/mix-audio.mjs` loops it to length, ducks it under the voice and normalises
the mix to -14 LUFS, so the bed does not need to be edited to picture.

## What the video is

An 11-minute founder update to pre-order customers and advisors: the first 50
units came off the line in Shenzhen, every test passed, 200 more ship in
September, launch in October. Warm, direct, a little tired, genuinely excited.
The brand is storybook warmth + 8-bit pixel playfulness — a screen-free
companion device for kids 6–9.

## Mood arc

```
0:00–1:10   grounded, patient        (apology, timeline, "good news")
1:10–5:30   curious → busy           (the device, the factory, the tests)
5:30–8:30   confident, lighter       (results, DVT, certification, the app)
8:30–10:00  forward-looking, warm    (roadmap, the molding factory, launch)
10:00–11:05 sincere, gentle          (thanks, the ask)
```

Do NOT score the arc with hard section changes — the bed runs under speech the
whole way and the ducking does the dynamics. One consistent bed, two textures
at most, that could loop for 12 minutes without drawing attention.

## Sound

- **Genre:** minimal electronic documentary. Soft synth pulse, muted mallets or
  plucked synth, a warm sub bass. A little 8-bit colour (a square-wave lead or
  chiptune arpeggio) is on-brand — used as texture, low in the mix, never a melody
  that competes with speech.
- **Tempo:** 100–108 BPM. Steady, unhurried.
- **Key:** major, warm — C, F or G.
- **Dynamics:** quiet. Peaks at least 6 dB under a normal film bed; this sits at
  -16 dB under dialogue.
- **Length:** 3–4 minutes, loopable (ends on the chord it started on, no tail).

## Avoid

- Vocals, choirs, "oohs".
- Cinematic trailer drums, risers, drops, big reverb swells.
- Corporate-ukulele / whistling / hand claps.
- Anything that sounds like a kids' TV theme — the audience here is the parents.
- Chiptune as the foreground: the pixel motif is seasoning, not the dish.

## Prompt (paste-ready)

> Minimal electronic documentary underscore, 104 BPM, warm major key, soft synth
> pulse with muted plucked synth and warm sub bass, subtle lo-fi 8-bit arpeggio
> texture low in the mix, calm and steady, no vocals, no drums fills, no risers or
> drops, loopable, gentle and optimistic, background music for a founder
> speaking to camera about building a hardware product.

## SFX

Cues are generated from the edit (`node ../../bin/sfx-cues.mjs`) into
`sfx-cues.json`; drop these five files into `sfx/` and the mixer picks them up:

| file | used for | character |
| --- | --- | --- |
| `impact-soft.wav` | a card landing | short, soft, low thud — felt, not heard |
| `tick.wav` | count-up figures | tiny UI tick, pixel-ish |
| `whoosh.wav` | cut to full-frame B-roll | short air movement, no tail |
| `click.wav` | process step lighting up | dry mechanical click |
| `chime.wav` | end card | two-note pixel chime, warm |

Budget is enforced: one noticeable hit per 6 seconds at most.
