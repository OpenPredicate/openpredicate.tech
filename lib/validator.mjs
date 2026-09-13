/**
 * validator.mjs — compile the grammar into a standalone browser validator.
 *
 * The playground validates against the real grammar, not a reimplementation of
 * it. Rather than shipping a validator to the browser and compiling the schema
 * there — which would mean a third-party script on a specification site and a
 * network round trip before the page works — the schema is compiled at build
 * time into a dependency-free ES module.
 *
 * The output is generated from the same file the site serves at the schema's
 * `$id`, so the two cannot disagree.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import * as esbuild from "esbuild";

const TMP = ".tmp";

/**
 * @param {object} schema the parsed grammar
 * @param {string} outfile where to write the bundled ES module (.js, so
 *   that every static host serves it as JavaScript)
 * @returns {Promise<{bytes: number}>}
 */
export async function buildValidator(schema, outfile) {
  const ajv = new Ajv2020({
    code: { source: true, esm: true },
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  // `format: "regex"` on $regex is the one format assertion that narrows
  // anything; the date and time ones sit beside a plain string branch.
  addFormats(ajv);
  ajv.addVocabulary(["x-profiles", "x-open-predicate"]);

  const validate = ajv.compile(schema);

  // Ajv's standalone output calls require() for its runtime helpers and for
  // the format table. Those resolve in Node but not in a browser, so the
  // module is bundled before it is served.
  await mkdir(TMP, { recursive: true });
  const raw = join(TMP, "validator.raw.mjs");
  await writeFile(raw, standaloneCode(ajv, validate));

  const result = await esbuild.build({
    entryPoints: [raw],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
  });

  await rm(TMP, { recursive: true, force: true });

  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  return { bytes };
}

/**
 * Sanity-check the bundle before it is published. A validator that accepts
 * everything, or rejects everything, would make the playground lie — and the
 * page is one of the first things a reader tries.
 */
export async function checkValidator(outfile) {
  const { default: validate } = await import(`${process.cwd()}/${outfile}?t=${Date.now()}`);

  const cases = [
    [{ status: "available" }, true, "scalar shorthand"],
    [{ $and: [{ a: 1 }] }, true, "$and with one filter"],
    [{ tags: { $some: { $in: ["a"] } } }, true, "quantified array"],
    [{ price: { $gt: { $field: "cost" } } }, true, "field reference"],
    [{ age: { $gt: 18, $lt: 30 } }, true, "implicit AND on one field"],
    [{}, false, "empty filter"],
    [{ $and: [] }, false, "$and with no filters"],
    [{ a: { $nope: 1 } }, false, "unknown operator"],
    [{ "items[*].qty": { $gt: 2 } }, false, "removed wildcard path"],
    [{ a: { $unknownAs: true } }, false, "$unknownAs with nothing to modify"],
    [{ a: { $flags: "i" } }, false, "$flags without $regex"],
    [{ a: { $in: [] } }, false, "empty operand set"],
  ];

  const failures = cases
    .filter(([filter, want]) => validate(filter) !== want)
    .map(([filter, want, label]) => `${label}: expected ${want} for ${JSON.stringify(filter)}`);

  if (failures.length) {
    throw new Error(`The generated validator is wrong:\n  ${failures.join("\n  ")}`);
  }

  return cases.length;
}

/** Read the grammar the site serves, so everything derives from one file. */
export async function readSchema(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
