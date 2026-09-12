# Music brief — Little Thing of Nowa, ep. 03 (why it is a virtual pet game)

For Suno / ElevenLabs Music / a composer. Output to `music/bed.mp3`;
`bin/mix-audio.mjs` loops it, ducks it under the voice and normalises to −14 LUFS.

## What the video is

7 min 7 s, the longest of the three. He explains why the game on the device is a
virtual pet: the 2000s were the dopamine era, Tamagotchi was not, and a Bandai
designer built it for people who could not keep a real pet. It sold 100 million
units on a loop that is slow and frankly annoying — feed it, play with it, put it
to bed — and gives nothing back. That is exactly why it worked: caring costs you
something, and what you pay for, you become attached to.

Reflective and a little affectionate. He is defending a design that sounds like a
bad idea until you hear the argument.

## Mood arc

```
0:00–1:10   curious, setting up        (what game belongs on this hardware)
1:10–2:10   wry                        (the dopamine era, and the odd one out)
2:10–3:30   patient, slightly rueful   (caring is annoying, and gives nothing back)
3:30–4:20   warm, the turn             (that IS the point: care becomes attachment)
4:20–5:30   settled, forward           (so we rebuilt it, with better hardware)
5:30–7:07   quietly firm               (and the pet still will not talk like a chatbot)
```

One bed throughout; the ducking supplies the dynamics. The turn at 3:30 is
carried by the words, not by a key change.

## Sound

- **Genre:** warm minimal electronic with a slightly nostalgic edge. Soft plucked
  synth, muted keys, warm sub bass, light tape noise. A restrained chiptune blip
  is on-brand — the episode is about a 1990s handheld — but it must stay texture,
  never a melody line.
- **Tempo:** 90–100 BPM.
- **Key:** major, gentle; a little wistfulness suits the Tamagotchi half.
- **Dynamics:** quiet and even, sitting −16 dB under dialogue.
- **Length:** 3–4 minutes, loopable, ends on the chord it starts on.

## Avoid

- Vocals of any kind.
- Trailer drums, risers, drops, big reverb swells.
- Full-on 8-bit arcade pastiche. The nostalgia here is affectionate, not a gag,
  and a chiptune parody would undercut a serious argument about child development.
- The brightness of children's television — the audience is the parents.
- Anything that gets busy under the 2:10–3:30 stretch, which is the quietest and
  most important part of the video.

## Prompt (paste-ready)

> Warm minimal electronic underscore, 94 BPM, gentle major key with a wistful
> edge, soft plucked synth and muted tape keys over warm sub bass, faint tape
> noise, one restrained chiptune blip as texture low in the mix, calm and
> reflective, no vocals, no drum fills, no risers or drops, loopable, background
> music for a founder explaining why he built a virtual pet.

## SFX

34 cues generated into `sfx-cues.json` (budget: one noticeable hit per 6 s).
Files go in `sfx/`: `impact-soft.wav` (card lands), `tick.wav` (the two
count-ups), `whoosh.wav` (cut to B-roll), `chime.wav` (end card).

**Worth adding by hand:** a single Tamagotchi-style *beep* under the 3:09 beat,
where he says it beeps at you every thirty minutes. One beep, once — the joke is
that it is annoying, and hearing it once makes the point no card can.
