/**
 * sync.mjs — pull the specification artefacts in from the spec repository.
 *
 * The site renders the normative documents rather than paraphrasing them, so
 * those files live here as vendored copies and this script refreshes them. It
 * is deliberately a separate step from the build: a build never reaches the
 * network, so it is reproducible and cannot be broken by a push upstream.
 *
 *   node sync.mjs              # from main
 *   node sync.mjs v0.5.0       # from a tag
 */

import { writeFile } from "node:fs/promises";

import { SITE } from "./lib/layout.mjs";

const ref = process.argv[2] ?? "main";
const base = `https://raw.githubusercontent.com/OpenPredicate/open-predicate/${ref}`;

const FILES = [
  ["SPEC.md", "content/SPEC.md"],
  ["CHANGELOG.md", "content/CHANGELOG.md"],
  ["COMPARISON.md", "content/COMPARISON.md"],
  ["examples/pet.capabilities.json", "content/pet.capabilities.json"],
  ["examples/pet.filter.json", "content/pet.filter.json"],
  ["examples/pet.schema.json", "content/pet.schema.json"],
  [
    "open-predicate-schema.json",
    `static/schema/v${SITE.grammarVersion}/open-predicate-schema.json`,
  ],
];

let failed = false;

for (const [from, to] of FILES) {
  const url = `${base}/${from}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = await res.text();
    await writeFile(to, body);
    console.log(`  ${from} → ${to} (${body.length} bytes)`);
  } catch (err) {
    failed = true;
    console.error(`  FAILED ${url}: ${err.message}`);
  }
}

if (failed) {
  console.error(
    `\nOne or more files could not be fetched from ${ref}. Nothing was rolled back — check ` +
      `git diff before committing, and confirm the rename to open-predicate has been pushed.`,
  );
  process.exit(1);
}

console.log(`\nSynced from ${ref}. Run 'npm run build' and check the diff.`);
