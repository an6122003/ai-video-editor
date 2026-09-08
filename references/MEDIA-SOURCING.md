# Media sourcing

How to get the images the video is talking about, and place them on the beat
where they are named. This is the "agent finds the picture" pipeline.

## 0. Whether an image belongs at all

Answer this before sourcing anything. An image is doing one of two jobs:

**Comprehension.** The script names something the viewer cannot see — a product
out of frame, a chip inside the case, a model, a tool's interface. Read the line
and ask whether someone who has never seen the thing can picture it. If not,
source an image; that blank is exactly what the image fills.

**Attribution.** Brand logos — sponsor, vendor, credited tools. Not a judgement
call, an obligation.

Anything else is decoration. In particular, **do not place an image where a card
already carries the idea**: a stat, a bar chart, a pipeline list *is* the
visual, and a logo next to it splits the beat between two things that then both
read weakly.

Bias to fewer. One image per ten seconds reads as evidence; one per three reads
as a slideshow with a man in it.

### A logo is not a picture of the thing

The trap this catches: the script names something abstract, you reach for the
vendor's wordmark, and you tell yourself it aids comprehension. It does not.

"một con GPU NVIDIA GB10" names a chip sealed inside the case. The NVIDIA
wordmark does not show anyone what that chip is, how big it is, or what it does.
It is a brand mark floating in the corner — decoration wearing a comprehension
justification. Worse, it competes with the captions for the same top band and
puts someone else's logo on screen for no editorial reason.

So, for anything the script names:

- **Show the actual thing** — the product photo, the die shot, the tool's UI, the
  chart. That is evidence.
- **Or place nothing.** The words carry it. A talking head naming a chip is
  perfectly comprehensible without a logo.

**Bare vendor wordmarks are attribution-only** — the sponsor, on the beat where
they are thanked. Never as illustration, never mid-explanation, never because a
brand happened to be mentioned. If the entry's `note` says COMPREHENSION but the
asset is a logo, the note is wrong and the placement should be cut.

## 1. What needs an asset

```bash
node topics.mjs
```

Reads `transcript.json` and prints every product, tool and vendor the video
names, with the timestamps. Mentions inside 4s collapse into one beat — one
asset per beat, not per word. `--json` gives the same thing for seeding
`logos.json`.

The timestamps **are** the placement times. An asset belongs on screen when the
thing is named.

## 2. The source ladder

Work down it. Stop at the first rung that gives a usable asset.

**1 — Official site capture.** The best source for a product shot, a docs page,
or an app UI:

```bash
npx hyperframes capture "https://vendor.com/product" -o media/cap-<name> --skip-vision --max-screenshots 4
```

This drives real headless Chrome, so it renders the page as a browser does and
gets through the bot-blocking that stops `curl` and plain fetch — GIGABYTE's
product page returns **403 to curl and to WebFetch, and captures fine**. It
downloads the page's own images too, which is usually where the clean
transparent product PNG lives.

Read `media/cap-<name>/extracted/asset-descriptions.md` and the contact sheets
first; open individual files only to check the one you want. Then copy the
chosen file into `media/shots/` or `media/logos/` and reference it from
`logos.json`.

**2 — Press kit / brand page.** Vendors publish logo and product imagery
intended for exactly this. Usually an SVG or transparent PNG, better than
anything scraped.

**3 — Docs / app screenshot.** For software, capture the docs page or take the
screenshot yourself. A real screenshot of the tool you are describing is more
convincing than a stock image of a laptop.

**4 — Generated.** When nothing real exists (a diagram, an abstract concept),
generate it rather than borrowing something that means almost the right thing.

**5 — Web image search.** Last resort, and read the licensing note below before
using it.

## 3. When a source blocks you

Order of escalation:

1. `hyperframes capture` — real Chrome, handles most blocking. Try this first.
2. A local browser session (Playwright / the browser tools) — for pages behind
   a login or an interaction, drive the page and screenshot it.
3. Save the file by hand. Not everything is worth automating.

`curl` and plain HTTP fetch are the *weakest* option, not the first one — they
carry no browser fingerprint and get 403s from any site with basic protection.

## 4. Licensing — read this before automating it

Auto-placing arbitrary image-search results into a monetised, sponsored video is
a real risk, not a theoretical one. The ladder above is ordered by licence
safety as much as by quality:

- **Official product imagery and press kits** are published for editorial and
  review use. Safe, and what a sponsor expects.
- **Screenshots of software you are reviewing** are standard editorial practice.
- **Generated images** you own.
- **Image-search results** are someone's copyrighted work by default. Do not
  place them automatically. If one is genuinely needed, check the licence, and
  prefer a source with an explicit one.

Practically: keep a human in the loop for anything from rung 5. The agent
proposes with the source URL, you approve, then it freezes the file.

## 5. Freeze it locally

A render fetches nothing at runtime. Every asset must be a local file before
the build:

```
media/
  logos/     brand marks       -> logos.json `file`
  shots/     product + UI      -> logos.json `file`
  cap-*/     raw captures      (source material, not referenced directly)
```

Copy the chosen asset out of the capture directory rather than pointing at it —
captures are large and disposable; the assets you picked are not.

## 6. Place it

Add to `logos.json` with the beat from step 1:

```jsonc
{ "file": "ai-top-atom.png", "at": 4.3, "dur": 3.2, "slot": "topleft", "w": 340,
  "note": "official product PNG, gigabyte.com capture" }
```

Keep `note` honest about where it came from. Six months later that is the only
record of whether the asset was cleared for use.
