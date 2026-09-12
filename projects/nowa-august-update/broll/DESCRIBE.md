# B-roll describe worklist

40 clips · 27.6 min · 46 sheets · 0 clips still undescribed.

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
| 1 | `DJI_20260805093900_0004_D.MP4` | 2026-08-05 09:39:00 | 39s | dji-20260805093900-0004-d-01.jpg | ✓
| 2 | `DJI_20260805094125_0007_D.MP4` | 2026-08-05 09:41:25 | 48s | dji-20260805094125-0007-d-01.jpg | ✓
| 3 | `DJI_20260805094301_0009_D.MP4` | 2026-08-05 09:43:01 | 24s | dji-20260805094301-0009-d-01.jpg | ✓
| 4 | `DJI_20260805094330_0010_D.MP4` | 2026-08-05 09:43:30 | 21s | dji-20260805094330-0010-d-01.jpg | ✓
| 5 | `DJI_20260805094355_0011_D.MP4` | 2026-08-05 09:43:55 | 5s | dji-20260805094355-0011-d-01.jpg | ✓
| 6 | `DJI_20260805094410_0012_D.MP4` | 2026-08-05 09:44:10 | 4s | dji-20260805094410-0012-d-01.jpg | ✓
| 7 | `DJI_20260805094524_0015_D.MP4` | 2026-08-05 09:45:24 | 17s | dji-20260805094524-0015-d-01.jpg | ✓
| 8 | `DJI_20260805094547_0016_D.MP4` | 2026-08-05 09:45:47 | 23s | dji-20260805094547-0016-d-01.jpg | ✓
| 9 | `DJI_20260805094705_0017_D.MP4` | 2026-08-05 09:47:05 | 37s | dji-20260805094705-0017-d-01.jpg | ✓
| 10 | `DJI_20260805094747_0018_D.MP4` | 2026-08-05 09:47:47 | 64s | dji-20260805094747-0018-d-01.jpg | ✓
| 11 | `DJI_20260805094924_0019_D.MP4` | 2026-08-05 09:49:24 | 10s | dji-20260805094924-0019-d-01.jpg | ✓
| 12 | `DJI_20260805094950_0020_D.MP4` | 2026-08-05 09:49:50 | 54s | dji-20260805094950-0020-d-01.jpg | ✓
| 13 | `DJI_20260805095502_0022_D.MP4` | 2026-08-05 09:55:02 | 60s | dji-20260805095502-0022-d-01.jpg | ✓
| 14 | `DJI_20260805095809_0023_D.MP4` | 2026-08-05 09:58:09 | 121s | dji-20260805095809-0023-d-01.jpg, dji-20260805095809-0023-d-02.jpg | ✓
| 15 | `DJI_20260805100022_0024_D.MP4` | 2026-08-05 10:00:22 | 16s | dji-20260805100022-0024-d-01.jpg | ✓
| 16 | `DJI_20260805100058_0025_D.MP4` | 2026-08-05 10:00:58 | 26s | dji-20260805100058-0025-d-01.jpg | ✓
| 17 | `DJI_20260805100702_0026_D.MP4` | 2026-08-05 10:07:02 | 105s | dji-20260805100702-0026-d-01.jpg, dji-20260805100702-0026-d-02.jpg | ✓
| 18 | `DJI_20260805100940_0028_D.MP4` | 2026-08-05 10:09:40 | 84s | dji-20260805100940-0028-d-01.jpg, dji-20260805100940-0028-d-02.jpg | ✓
| 19 | `DJI_20260805102055_0029_D.MP4` | 2026-08-05 10:20:55 | 38s | dji-20260805102055-0029-d-01.jpg | ✓
| 20 | `DJI_20260805102230_0030_D.MP4` | 2026-08-05 10:22:30 | 26s | dji-20260805102230-0030-d-01.jpg | ✓
| 21 | `DJI_20260805102337_0031_D.MP4` | 2026-08-05 10:23:37 | 24s | dji-20260805102337-0031-d-01.jpg | ✓
| 22 | `DJI_20260805102406_0032_D.MP4` | 2026-08-05 10:24:06 | 18s | dji-20260805102406-0032-d-01.jpg | ✓
| 23 | `DJI_20260805102436_0033_D.MP4` | 2026-08-05 10:24:36 | 28s | dji-20260805102436-0033-d-01.jpg | ✓
| 24 | `DJI_20260805103145_0035_D.MP4` | 2026-08-05 10:31:45 | 29s | dji-20260805103145-0035-d-01.jpg | ✓
| 25 | `DJI_20260805104511_0037_D.MP4` | 2026-08-05 10:45:11 | 15s | dji-20260805104511-0037-d-01.jpg | ✓
| 26 | `DJI_20260805104541_0038_D.MP4` | 2026-08-05 10:45:41 | 14s | dji-20260805104541-0038-d-01.jpg | ✓
| 27 | `DJI_20260805104613_0039_D.MP4` | 2026-08-05 10:46:13 | 20s | dji-20260805104613-0039-d-01.jpg | ✓
| 28 | `DJI_20260805105802_0040_D.MP4` | 2026-08-05 10:58:02 | 33s | dji-20260805105802-0040-d-01.jpg | ✓
| 29 | `Lắp mạch nối.mp4` | 2026-08-05 14:33:14 | 19s | lap-mach-noi-01.jpg | ✓
| 30 | `Lắp màn hình.mp4` | 2026-08-05 14:35:30 | 41s | lap-man-hinh-01.jpg | ✓
| 31 | `Lắp loa.mp4` | 2026-08-05 14:36:00 | 90s | lap-loa-01.jpg, lap-loa-02.jpg | ✓
| 32 | `overview 2.mp4` | 2026-08-05 14:41:58 | 56s | overview-2-01.jpg | ✓
| 33 | `lắp ốc vít.mp4` | 2026-08-05 14:42:48 | 40s | lap-oc-vit-01.jpg | ✓
| 34 | `Test products.mp4` | 2026-08-10 17:56:44 | 88s | test-products-01.jpg, test-products-02.jpg | ✓
| 35 | `1.MP4` | 2026-08-11 19:06:26 | 15s | 1-01.jpg | ✓
| 36 | `2.mp4` | 2026-08-11 19:26:14 | 50s | 2-01.jpg | ✓
| 37 | `3.MP4` | 2026-08-11 19:31:56 | 21s | 3-01.jpg | ✓
| 38 | `4.MP4` | 2026-08-11 19:38:14 | 42s | 4-01.jpg | ✓
| 39 | `5.MP4` | 2026-08-11 19:39:56 | 120s | 5-01.jpg, 5-02.jpg | ✓
| 40 | `6.mp4` | 2026-08-11 19:47:44 | 73s | 6-01.jpg | ✓
