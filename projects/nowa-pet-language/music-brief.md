# Music brief — Little Thing of Nowa, ep. 02 (why the pet does not speak human)

For Suno / ElevenLabs Music / a composer. Output to `music/bed.mp3`;
`bin/mix-audio.mjs` loops it to length, ducks it under the voice and normalises
to -14 LUFS, so it does not need to be cut to picture.

## What the video is

4 min 47 s. The founder answers the question everyone asked him: why isn't the
pet an AI chatbot that speaks English? Because these kids will have AI agents in
every room by the time they are ten, and he would rather they imagined. The
argument leans on Pokemon ("Pika Pika") and I Am Groot: one sound, any emotion,
and the child does the interpreting. It ends on the hardware — the pet has its
own voice, and the voice changes as the pet grows.

The register is warm and slightly contrarian. He is arguing against the obvious
choice, fondly, not angrily.

## Mood arc

```
0:00-0:45   open, curious            (the question, the objection)
0:45-1:30   uneasy, a shade darker   (AI in every room, everything too early)
1:30-2:40   playful, brightening     (Pokemon, Pika Pika, the range of emotion)
2:40-3:35   warm, wondering          (I Am Groot, the child interprets)
3:35-4:15   a little wry             (toys bolting on AI, lazily)
4:15-4:47   settled, affectionate    (its own voice, growing with the pet)
```

One bed the whole way; the ducking supplies the dynamics. The two "darker"
stretches want no score change — the words carry it.

## Sound

- **Genre:** playful minimal electronic with a toy-box edge. Muted mallets or
  kalimba-ish plucks, soft synth pad, warm sub bass. This episode is *about*
  expressive sound, so a small amount of 8-bit voice-like blip texture is more
  than on-brand — but it must never sound like it is answering the pet.
- **Tempo:** 96-104 BPM.
- **Key:** major, bright but not saccharine.
- **Dynamics:** quiet and even; it sits -16 dB under dialogue.
- **Length:** 2-3 minutes, loopable, ends on the chord it starts on.

## Avoid

- Vocals or anything that reads as a voice saying words — the whole thesis is
  that the pet does not speak human. A wordless blip is fine; a vocal sample is
  not, and a "cute voice" sample is actively wrong.
- Trailer drums, risers, drops.
- Kids'-TV brightness or nursery melodies — the audience is the parents.
- Chiptune as the foreground.

## Prompt (paste-ready)

> Playful minimal electronic underscore, 100 BPM, bright major key, muted mallet
> and kalimba plucks over a soft synth pad and warm sub bass, tiny wordless
> 8-bit blip texture low in the mix, calm and affectionate, no vocals, no drum
> fills, no risers or drops, loopable, background music for a founder explaining
> why his toy does not talk.

## SFX

Cues generate from the edit (`node ../../bin/sfx-cues.mjs`) into
`sfx-cues.json` — 25 kept, budget one noticeable hit per 6 s. Files go in `sfx/`.

| file | used for |
| --- | --- |
| `impact-soft.wav` | a card landing |
| `tick.wav` | the one count-up |
| `whoosh.wav` | cut to full-frame B-roll |
| `chime.wav` | end card |

**Worth adding by hand for this episode:** the pet's own two-syllable sound
under the "Pika Pika." card at 2:11, and again under the emotions list at 2:24 —
three different readings of the same blip (curious / delighted / sad). This
episode argues that one sound can carry any feeling; letting the audience hear
that once is worth more than the card. Do NOT use a Pikachu sample.
