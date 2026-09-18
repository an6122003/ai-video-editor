# B-roll describe worklist

11 clips · 25.6 min · 29 sheets · 0 clips still undescribed.

Read each sheet (4×4, row-major, each tile stamped with its source time) and
write the clip's `segments` into `index.json`. A segment is a stretch where
the same thing is happening — the boundaries are where the reader sees the
subject, station or action change. Schema per segment:

```jsonc
{
  "start": 0,   "end": 28,          // seconds, from the tile stamps
  "action": "worker fits speaker module into device shell on assembly tray",
  "subject": ["worker hands", "speaker module", "device shell", "tray"],
  "shot": "close-up | medium | wide | establishing | detail | pov",
  "motion": "static | handheld | pan | tilt | push-in | follow",
  "tags": ["assembly", "speaker", "factory", "hands", "tray"],
  "quality": 1-5,                   // 5 = clean, sharp, well framed
  "usable": true,                   // false for shaky, blurred, blocked
  "sequence": "speaker-fit",        // optional: name the multi-clip sequence this belongs to
  "note": ""                        // anything the director should know (people's faces, logos, text on screen)
}
```

Tags are what the SCRIPT would say, not what the vendor would say — if the
speaker says "the board", tag `board`, `pcb`, `circuit`.

| # | clip | shot at | dur | sheets |
| - | ---- | ------- | --- | ------ |
| 1 | `Gray-videos-clean-v2.mp4` | 2026-09-09 15:47:10 | 16s | gray-videos-clean-v2-01.jpg | ✓
| 2 | `nori.mov` | 2026-09-10 12:41:06 | 28s | nori-01.jpg | ✓
| 3 | `Outside device.mov` | 2026-09-11 15:53:16 | 54s | outside-device-01.jpg | ✓
| 4 | `Scroll room, command pet play, shake device.mov` | 2026-09-11 15:56:06 | 116s | scroll-room-command-pet-play-shake-device-01.jpg, scroll-room-command-pet-play-shake-device-02.jpg | ✓
| 5 | `Careloop - Eat, shines, love.mov` | 2026-09-11 15:59:00 | 118s | careloop-eat-shines-love-01.jpg, careloop-eat-shines-love-02.jpg | ✓
| 6 | `Talking with pet.mov` | 2026-09-11 16:00:52 | 95s | talking-with-pet-01.jpg, talking-with-pet-02.jpg | ✓
| 7 | `Podcast activation - voice and buttons.mov` | 2026-09-11 16:04:54 | 203s | podcast-activation-voice-and-buttons-01.jpg, podcast-activation-voice-and-buttons-02.jpg, podcast-activation-voice-and-buttons-03.jpg, podcast-activation-voice-and-buttons-04.jpg | ✓
| 8 | `Arcade.mov` | 2026-09-11 16:06:38 | 91s | arcade-01.jpg, arcade-02.jpg | ✓
| 9 | `Mission.mov` | 2026-09-11 16:10:02 | 194s | mission-01.jpg, mission-02.jpg, mission-03.jpg, mission-04.jpg | ✓
| 10 | `Nori talking and playing songs_ podcast via voice.mov` | 2026-09-16 19:27:36 | 185s | nori-talking-and-playing-songs-podcast-via-voice-01.jpg, nori-talking-and-playing-songs-podcast-via-voice-02.jpg, nori-talking-and-playing-songs-podcast-via-voice-03.jpg | ✓
| 11 | `Nowa parent Missions set up with device.mov` | 2026-09-16 19:56:18 | 439s | nowa-parent-missions-set-up-with-device-01.jpg, nowa-parent-missions-set-up-with-device-02.jpg, nowa-parent-missions-set-up-with-device-03.jpg, nowa-parent-missions-set-up-with-device-04.jpg, nowa-parent-missions-set-up-with-device-05.jpg, nowa-parent-missions-set-up-with-device-06.jpg, nowa-parent-missions-set-up-with-device-07.jpg | ✓
