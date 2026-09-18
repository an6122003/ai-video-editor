#!/usr/bin/env node
// Re-file a library that is already published, without touching its footage.
//
//   node bin/broll-meta.mjs <library.json> --category nowa-factory-footage \
//        --category-label "Nowa factory footage" --title "Nowa factory"
//
//   node bin/broll-meta.mjs <library.json>            # just show what is set
//
// Categories are presentation: which shelf a library sits on in the gallery,
// and what an agent can narrow a search to. None of that is derived from the
// footage, so changing it should not mean re-encoding 40 proxies and pushing
// 12 GB back up a domestic uplink — it is a dozen bytes in one JSON file.
//
// `version` is deliberately left alone. It is a fingerprint of the CLIP
// content, and projects pin it in broll/library.lock so an edit stays
// reproducible. Re-filing a library changes nothing a past edit depended on,
// so bumping the version would invalidate those locks for no reason.
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FILE = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);

if (!FILE || args.includes("--help")) {
  console.log(`Re-file a published library — category, title, blurb — without re-uploading footage.

  node bin/broll-meta.mjs <path/to/library.json> [options]

  --title <text>                 display name for the library
  --description <text>           one line about what is in it
  --category <slug>              the shelf it sits on, e.g. nowa-factory-footage
  --category-label <text>        how that shelf is spelled out  (default: from the slug)
  --category-description <text>  one line about the category
  --order <n>                    sort position among categories (lower first, default 500)

With no options it prints what the file currently says and changes nothing.`);
  process.exit(FILE ? 0 : 1);
}

const path = resolve(FILE);
if (!existsSync(path)) {
  console.error(`No such file: ${path}`);
  process.exit(1);
}

const lib = JSON.parse(await readFile(path, "utf8"));
const titleCase = (s) => s.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");

const show = (l) => {
  console.log(`  library     ${l.library}`);
  console.log(`  title       ${l.title ?? "(unset — the server will guess from the id)"}`);
  console.log(`  description ${l.description ?? "(unset)"}`);
  console.log(`  category    ${l.category
    ? `${l.category.id}  "${l.category.label}"${l.category.order !== undefined ? `  order ${l.category.order}` : ""}`
    : "(unset — the server files this as Unfiled)"}`);
  console.log(`  version     ${l.version}   ${l.totals?.clips ?? "?"} clips · ${l.totals?.segments ?? "?"} segments`);
};

const wants = ["--title", "--description", "--category", "--category-label",
               "--category-description", "--order"].some((f) => args.includes(f));
if (!wants) {
  console.log(`\n${path}\n`);
  show(lib);
  console.log("");
  process.exit(0);
}

console.log(`\n${path}\n\nbefore:`);
show(lib);

const title = flag("--title");
const description = flag("--description");
const category = flag("--category");
const categoryLabel = flag("--category-label");
const categoryDesc = flag("--category-description");
const order = flag("--order");

if (title !== null) lib.title = title;
if (description !== null) lib.description = description;

// Label, blurb and order can be set on their own, but only once the library
// actually belongs to a category — otherwise you get a half-written category
// block that the server has to guess its way around.
if (category !== null) {
  lib.category = {
    ...(lib.category ?? {}),
    id: slugify(category),
    label: categoryLabel ?? lib.category?.label ?? titleCase(slugify(category)),
  };
} else if ((categoryLabel ?? categoryDesc ?? order) !== null && !lib.category) {
  console.error("\nThis library has no category yet — pass --category <slug> as well.");
  process.exit(1);
}
if (lib.category) {
  if (categoryLabel !== null) lib.category.label = categoryLabel;
  if (categoryDesc !== null) lib.category.description = categoryDesc;
  if (order !== null) {
    const n = Number(order);
    if (!Number.isFinite(n)) { console.error("\n--order must be a number."); process.exit(1); }
    lib.category.order = n;
  }
}

// The catalogue is the only copy of a describe pass that may have taken hours
// of somebody reading contact sheets. Keep the last one.
await copyFile(path, `${path}.bak`);
await writeFile(path, JSON.stringify(lib, null, 2));

console.log("\nafter:");
show(lib);
console.log(`\nWritten. Previous file kept as ${path}.bak`);
console.log("Push just this file to the server — no footage moves:");
console.log(`  scripts/broll_deploy.sh push ${lib.library} ${path}\n`);
