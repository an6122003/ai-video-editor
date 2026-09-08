# CapCut draft format

Reverse-engineered from a real project on this machine: **CapCut 9.3.0 (macOS),
`draft_content.json` version `360000`**. Undocumented and version-specific —
re-verify against a live draft before trusting it after any CapCut update.

Everything here was read from `com.lveditor.draft/0813`, an 8-track 717 KB
project, not from documentation.

---

## Where drafts live

```
<DRAFTS_ROOT>/
  root_meta_info.json          the project INDEX — CapCut lists projects from this
  <project name>/
    draft_content.json         the timeline: materials + tracks
    draft_meta_info.json       per-project metadata (name, times, cover)
    draft_cover.jpg            thumbnail
    Resources/  Timelines/  common_attachment/  …   caches, safe to omit
```

Find the root by reading `root_path` in
`~/Movies/CapCut/User Data/Projects/com.lveditor.draft/root_meta_info.json`.

**It is often not local.** On this machine drafts live under
`~/Library/CloudStorage/GoogleDrive-…/Other computers/My Computer/com.lveditor.draft/`.
Writing there means writing into a sync folder — close CapCut first, and expect
Drive to churn afterwards.

---

## The three-file contract

A project that opens needs all three, and they must agree:

| File | Must match |
| --- | --- |
| `draft_content.json` | `duration` == sum of the longest track |
| `draft_meta_info.json` | `tm_duration` == `draft_content.duration`, `draft_fold_path` == the real folder |
| `root_meta_info.json` | one entry in `all_draft_store` whose `draft_fold_path` / `draft_json_file` point at the folder |

Mismatch symptoms: project missing from the list (no index entry), project listed
but fails to open (bad `draft_content`), or wrong length in the browser
(`tm_duration` disagrees).

---

## Units and identifiers

- **Time is microseconds.** 144.733 s -> `144733333`. Frames at 30 fps are
  `33333` µs; rounding drift shows as a one-frame gap between clips.
- **`tm_draft_create` / `tm_draft_modified` are microsecond epochs** (16 digits).
- **IDs are UPPERCASE UUID4 with hyphens**, 36 chars: `684845E7-562C-40FB-…`.
  Lowercase appears to work but nothing in a real draft uses it.
- **Paths are absolute.** No `~`, no relative paths.

---

## draft_content.json

Top level (36 keys; these are the load-bearing ones):

```jsonc
{
  "version": 360000,
  "new_version": "119.0.0",
  "id": "<UUID>",                       // project id, distinct from draft_id
  "duration": 144733333,                // µs, the whole timeline
  "fps": 30.0,
  "canvas_config": { "ratio": "original", "width": 1080, "height": 1920, "background": null },
  "color_space": 0,
  "render_index_track_mode_on": true,
  "free_render_index_mode_on": false,
  "materials": { /* ~55 buckets, see below */ },
  "tracks": [ /* see below */ ],
  "last_modified_platform": { "os": "mac", "app_version": "9.3.0", "app_source": "cc", … },
  "keyframes": { /* 8 empty arrays */ },
  "config": { /* 26 editor prefs */ }
}
```

`canvas_config.ratio` stays `"original"` for a custom size; `width`/`height`
carry the real canvas.

### materials

A dict of ~55 buckets, each an array. Only `videos` and `audios` reference real
files; the rest are per-segment property records.

```jsonc
"materials": {
  "videos":  [ /* video AND image materials — type "video" | "photo" */ ],
  "audios":  [ /* type "music" | "extract_music" */ ],
  "speeds":  [], "canvases": [], "placeholder_infos": [],
  "sound_channel_mappings": [], "vocal_separations": [],
  "material_colors": [], "material_animations": [],
  "effects": [], "beats": [], "texts": [], …
}
```

**A video material** (68 fields; the ones that matter):

```jsonc
{
  "id": "<UUID>",
  "type": "video",                 // "photo" for a still
  "path": "/abs/path/clip.mov",
  "material_name": "clip.mov",
  "width": 1080, "height": 1920,
  "duration": 144733333,           // µs — the FILE's full length
  "has_audio": false,
  "crop_ratio": "free",
  "crop": { "upper_left_x": 0, "upper_left_y": 0, "lower_right_x": 1, "lower_right_y": 1, … },
  "extra_type_option": 0,
  "source_platform": 0
}
```

Every other field can be copied verbatim from a working draft. Omitting fields
CapCut expects is the main cause of a draft that refuses to open.

### tracks

```jsonc
{
  "id": "<UUID>",
  "type": "video",            // "video" | "audio" | "effect" | "text" | "filter"
  "attribute": 0,
  "flag": 0,                  // 0 = base track, 2 = overlay (picture-in-picture)
  "name": "",
  "is_default_name": true,
  "segments": [ … ]
}
```

**`flag` is the important one.** The bottom video track is `flag: 0`; every
video track stacked above it is `flag: 2`. Getting this wrong makes overlays
behave as base clips.

Track order in the array is bottom-to-top. Within a track, `render_index`
resolves stacking; real drafts use 0 for the base and increment upward.

### segments

51 fields. The five that place a clip:

```jsonc
{
  "id": "<UUID>",
  "material_id": "<video material UUID>",
  "target_timerange": { "start": 0,        "duration": 4000000 },  // WHERE on the timeline
  "source_timerange": { "start": 38066666, "duration": 4000000 },  // WHICH part of the file
  "render_index": 1,
  "track_render_index": 1,
  "speed": 1.0,
  "volume": 1.0,
  "visible": true,
  "clip": {
    "scale":     { "x": 1.0, "y": 1.0 },
    "transform": { "x": 0.0, "y": 0.0 },   // -1..1, fraction of canvas from centre
    "rotation": 0.0,
    "flip": { "horizontal": false, "vertical": false },
    "alpha": 1.0
  },
  "extra_material_refs": [ /* 7 UUIDs — see below */ ]
}
```

**A cut is `source_timerange`, not a trim of the file.** To use 4 s starting at
38.07 s of a clip and place it at timeline 0, set `source_timerange.start` to
`38066666` and `target_timerange.start` to `0`. Both durations match unless
`speed` differs.

**`extra_material_refs` is mandatory.** Each video segment references one record
in each of these buckets — 7 UUIDs, all default-valued:

`speeds` · `placeholder_infos` · `canvases` · `material_animations` ·
`sound_channel_mappings` · `material_colors` · `vocal_separations`

They exist so the editor has somewhere to write per-clip speed curves, canvas
backgrounds, channel mappings and so on. Generate a fresh default record per
segment; sharing one across segments risks edits leaking between clips.

---

## draft_meta_info.json

Per-project sidecar (~45 keys, mostly empty strings). Load-bearing:

```jsonc
{
  "draft_id": "<UUID>",                 // must equal the index entry's draft_id
  "draft_name": "0813",
  "draft_fold_path": "/abs/path/<project>",
  "draft_root_path": "/abs/path/to/drafts/root",
  "draft_cover": "draft_cover.jpg",
  "tm_duration": 144733333,             // µs, must equal draft_content.duration
  "tm_draft_create":   1786627054157314,
  "tm_draft_modified": 1788440268290604,
  "tm_draft_removed": 0,
  "draft_timeline_materials_size_": 3183484221,   // bytes, informational
  "draft_materials": [ { "type": 0, "value": [ … ] } ]
}
```

Note the **trailing underscore** on `draft_timeline_materials_size_` in this
file — the index uses the same key *without* it. Easy typo, silent breakage.

---

## root_meta_info.json — the index

```jsonc
{ "root_path": "/abs/drafts/root", "draft_ids": [...], "all_draft_store": [ { … }, … ] }
```

One entry per project (~37 keys). Load-bearing: `draft_id`, `draft_name`,
`draft_fold_path`, `draft_json_file` (absolute path to `draft_content.json`),
`draft_root_path`, `draft_cover`, `tm_duration`, `tm_draft_create`,
`tm_draft_modified`, `streaming_edit_draft_ready: true`.

**This is the file to be careful with.** It holds every project — 80 on this
machine. Corrupt it and the whole project list disappears. Always:

1. Copy it to `root_meta_info.json.bak-<timestamp>` first.
2. Read, append one entry, write via a temp file + atomic rename.
3. Never rewrite entries you did not add.
4. **Close CapCut before writing** — it holds the file and will overwrite you on
   exit, or lose your entry to its in-memory copy.

---

## Recipe: stack an alpha overlay on footage

The layout this skill generates:

| Track | flag | Contents |
| --- | --- | --- |
| 0 | 0 | the raw talking-head clip, full length, audio on |
| 1 | 2 | `FINAL-overlay-alpha.mov` — cards + assets, transparent |
| 2 | 2 | `FINAL-captions-alpha.mov` — captions, transparent |

All three share one `target_timerange` starting at 0 with the same duration, so
they stay frame-aligned. Overlays carry `has_audio: false` and `volume: 1.0`
(harmless with no audio stream).

Verified: CapCut 9.3.0 reads **HEVC-with-alpha `.mov`** on an overlay track and
keeps the transparency — the `0813` draft already has `FINAL-overlay-alpha.mov`
placed this way.

---

## Failure modes seen or expected

| Symptom | Cause |
| --- | --- |
| Project not in the list | no `all_draft_store` entry, or `draft_fold_path` mismatch |
| Listed, spins, fails | malformed `draft_content.json` — usually a missing required field |
| Wrong duration in browser | `tm_duration` != `draft_content.duration` |
| Clips at wrong times | seconds written where microseconds were expected (1000000×) |
| Overlay covers everything | `flag: 0` on a track that should be `2` |
| Edits leak between clips | `extra_material_refs` shared instead of per-segment |
| Your entry vanishes | CapCut was open and rewrote the index on exit |
