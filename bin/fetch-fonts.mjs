#!/usr/bin/env node
// Downloads the two brand faces from Google Fonts as local woff2 subsets and
// writes a self-contained @font-face block.
//
//   node bin/fetch-fonts.mjs <outDir>        # default: fonts
//
// Fonts are fetched here, at setup, and never at render time — a render must be
// deterministic and offline. Only the vietnamese/latin/latin-ext subsets are
// kept; the unicode-range on each face is preserved so the browser picks the
// right file per glyph.
//
// Both faces cover Vietnamese, which is why headlines keep the display face
// even with full diacritics.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// One face set per brand. Both Nowa faces cover Vietnamese too; Tiny5 does
// not, but it is pet-world-only and never carries copy (BRAND-RULES).
const BRANDS = {
  anaha: [
    { css: "Space+Grotesk:wght@500;700", slug: "SpaceGrotesk" },
    { css: "Be+Vietnam+Pro:wght@400;600;800", slug: "BeVietnamPro" },
  ],
  nowa: [
    { css: "Onest:wght@400;700;800", slug: "Onest" },
    { css: "Noto+Sans:wght@400;600;700", slug: "NotoSans" },
    { css: "Tiny5", slug: "Tiny5" },
  ],
};
const brandIdx = process.argv.indexOf("--brand");
const BRAND = brandIdx >= 0 ? process.argv[brandIdx + 1] : "anaha";
const FAMILIES = BRANDS[BRAND];
if (!FAMILIES) {
  console.error(`unknown brand "${BRAND}" — one of: ${Object.keys(BRANDS).join(", ")}`);
  process.exit(1);
}
const KEEP = new Set(["vietnamese", "latin", "latin-ext"]);

const outDir = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--brand") ?? "fonts";
await mkdir(outDir, { recursive: true });

let faces = "";
let n = 0;
for (const fam of FAMILIES) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${fam.css}&display=block`,
    { headers: { "User-Agent": UA } },
  ).then((r) => r.text());

  const blocks = css.split(/\/\*\s*([a-z-]+)\s*\*\//i).slice(1);
  for (let i = 0; i < blocks.length; i += 2) {
    const subset = blocks[i].trim();
    const body = blocks[i + 1];
    if (!KEEP.has(subset)) continue;

    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1] ?? "400";
    const src = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
    if (!family || !src) continue;

    const file = `${fam.slug}-${weight}-${subset}.woff2`;
    const buf = Buffer.from(
      await fetch(src, { headers: { "User-Agent": UA } }).then((r) => r.arrayBuffer()),
    );
    await writeFile(join(outDir, file), buf);
    n++;

    faces += `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${weight};
  font-display: block;
  src: url("fonts/${file}") format("woff2");${range ? `\n  unicode-range: ${range};` : ""}
}\n`;
  }
}

await writeFile("_fontfaces.css", faces);
console.log(`${n} woff2 files -> ${outDir}/`);
console.log("@font-face block -> _fontfaces.css");
console.log(`\n${FAMILIES.map((f) => f.css.split(":")[0].replace(/\+/g, " ")).join(", ")}: SIL Open Font License 1.1.`);
