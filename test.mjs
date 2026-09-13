/**
 * test.mjs — check the built site, not the source.
 *
 * Three things are worth a test here. That every page and asset the navigation
 * promises actually exists in dist/. That the pages are internally linked to
 * pages that exist. And that the playground really validates — it is the first
 * thing a reader tries, so a playground that silently accepts everything would
 * be worse than no playground.
 *
 *   npm run build && node test.mjs
 */

import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import * as esbuild from "esbuild";

import { SITE } from "./lib/layout.mjs";

const SCHEMA = `schema/v${SITE.grammarVersion}/open-predicate-schema.json`;

const OUT = "dist";
const read = (p) => readFile(join(OUT, p), "utf8");
const exists = async (p) => {
  try {
    return (await stat(join(OUT, p))).isFile();
  } catch {
    return false;
  }
};

const PAGES = [
  "index.html",
  "spec/index.html",
  "operators/index.html",
  "playground/index.html",
  "problems/index.html",
  "problems/malformed-query/index.html",
  "problems/unknown-field/index.html",
  "problems/unsupported-operator/index.html",
  "problems/invalid-operand/index.html",
  "problems/query-too-complex/index.html",
  "schema/index.html",
  "changelog/index.html",
  "404.html",
];

const ASSETS = [
  "styles.css",
  "site.js",
  "playground.js",
  "validator.js",
  "sitemap.xml",
  "robots.txt",
  "_headers",
  "assets/logo.svg",
  "assets/logo-512.png",
  SCHEMA,
];

test("every page is built", async () => {
  for (const p of PAGES) assert.ok(await exists(p), `missing page: ${p}`);
});

test("every asset is built", async () => {
  for (const p of ASSETS) assert.ok(await exists(p), `missing asset: ${p}`);
});

test("the schema is served at its own $id", async () => {
  const schema = JSON.parse(await read(SCHEMA));
  assert.equal(schema.$id, SITE.schemaUrl);
});

/**
 * The versioned URL is the product: it is what an OpenAPI document `$ref`s and
 * what `curl -O` on /schema/ fetches. So it has to be the raw schema and
 * nothing else — not an HTML page, not a wrapper — and it has to be complete on
 * its own, because a consumer resolving that one URL gets no other file.
 */
test("the versioned URL is the raw schema, and complete on its own", async () => {
  const raw = await read(SCHEMA);

  // Byte-identical to what was vendored, so nothing rewrites it on the way out.
  assert.equal(raw, await readFile(`static/${SCHEMA}`, "utf8"));
  assert.ok(!raw.startsWith("<"), "the schema URL is serving markup, not JSON");

  const schema = JSON.parse(raw);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, SITE.schemaUrl);

  // Every $ref must be a local fragment. An external one would make the served
  // file an incomplete schema that silently fails to resolve for a consumer.
  const refs = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") refs.push(v);
      else walk(v);
    }
  };
  walk(schema);

  assert.ok(refs.length > 0, "expected the schema to use $ref internally");
  assert.deepEqual(
    refs.filter((r) => !r.startsWith("#")),
    [],
    "the schema has external $refs, so the versioned URL alone is not resolvable",
  );
});

/**
 * The version the site displays is only as good as the sync that produced it.
 * These two cross-check it against artefacts that were fetched independently,
 * so a half-finished sync — or a hand-edited constant — fails here rather than
 * shipping a site that claims to document a release it has not pulled in.
 */
test("the displayed version matches the vendored specification", async () => {
  const record = JSON.parse(await readFile("content/spec-version.json", "utf8"));
  assert.equal(SITE.releaseVersion, record.release, "SITE.releaseVersion is not what sync recorded");
  assert.equal(SITE.grammarVersion, record.grammar, "SITE.grammarVersion is not what sync recorded");

  // The changelog is fetched separately from the schema, so agreeing with it is
  // real evidence that both came from the same upstream ref.
  const changelog = await readFile("content/CHANGELOG.md", "utf8");
  assert.equal(
    changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1],
    SITE.releaseVersion,
    `the newest release in CHANGELOG.md is not v${SITE.releaseVersion} — run 'npm run sync'`,
  );

  const schema = JSON.parse(await read(SCHEMA));
  assert.equal(schema.$id, record.schemaId);
});

test("every published schema version is still served and listed", async () => {
  const published = (await readdir("static/schema", { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  assert.ok(published.includes(`v${SITE.grammarVersion}`), "the current grammar is not vendored");

  // A published $id is immutable, so an older version staying reachable is part
  // of the specification's promise, not a nicety.
  const index = await read("schema/index.html");
  const headers = await read("_headers");
  for (const dir of published) {
    assert.ok(
      await exists(`schema/${dir}/open-predicate-schema.json`),
      `${dir} is vendored but not published to dist/`,
    );
    assert.ok(index.includes(`<code>${dir}</code>`), `${dir} has no row on /schema/`);
    assert.ok(
      headers.includes(`/schema/${dir}/open-predicate-schema.json`),
      `${dir} has no _headers rule, so the host would serve it as plain JSON`,
    );
  }
});

test("the schema is served with the media type a $ref consumer expects", async () => {
  const headers = await read("_headers");
  assert.match(headers, /^ {2}Content-Type: application\/schema\+json; charset=utf-8$/m);
  assert.match(headers, /^ {2}Access-Control-Allow-Origin: \*$/m);
  // Safe only because a published $id never changes.
  assert.match(headers, /^ {2}Cache-Control: public, max-age=31536000, immutable$/m);
});

test("internal links point at pages that exist", async () => {
  const failures = [];
  for (const p of PAGES) {
    const html = await read(p);
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
      const target = href.endsWith("/") ? `${href.slice(1)}index.html` : href.slice(1);
      if (!target) continue;
      if (!(await exists(target))) failures.push(`${p} → ${href}`);
    }
  }
  assert.deepEqual(failures, [], `dead internal links:\n  ${failures.join("\n  ")}`);
});

test("no page leaks an unresolved template expression", async () => {
  for (const p of PAGES) {
    const html = await read(p);
    assert.ok(!html.includes("${"), `unresolved template literal in ${p}`);
    assert.ok(!html.includes("undefined"), `the string "undefined" appears in ${p}`);
  }
});

test("the operator reference covers every operator in x-profiles", async () => {
  const schema = JSON.parse(await read(SCHEMA));
  const html = await read("operators/index.html");
  for (const name of Object.values(schema["x-profiles"]).flat()) {
    assert.ok(html.includes(`id="op-${name.slice(1)}"`), `operator missing from reference: ${name}`);
  }
});

test("every problem page states its own type URI", async () => {
  for (const slug of [
    "malformed-query",
    "unknown-field",
    "unsupported-operator",
    "invalid-operand",
    "query-too-complex",
  ]) {
    const html = await read(`problems/${slug}/index.html`);
    assert.ok(
      html.includes(`https://openpredicate.tech/problems/${slug}`),
      `${slug} page does not carry its type URI`,
    );
  }
});

/**
 * Run the playground's real module against a stub DOM. `/validator.js` is an
 * absolute site path, so it is aliased to the built bundle.
 */
async function mountPlayground() {
  const bundle = await esbuild.build({
    entryPoints: ["static/playground.js"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
    plugins: [
      {
        // esbuild's `alias` option rejects names starting with "/", so the
        // site-absolute import is resolved to the built bundle by hand.
        name: "site-absolute-imports",
        setup(build) {
          build.onResolve({ filter: /^\/validator\.js$/ }, () => ({
            path: join(process.cwd(), "dist", "validator.js"),
          }));
        },
      },
    ],
  });

  const els = {};
  const make = (id) => ({
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    classList: { add() {}, remove() {}, contains: () => false },
    dataset: {},
    addEventListener() {},
    querySelectorAll: () => [],
    closest: () => null,
  });
  for (const id of ["filter-input", "status", "errors", "presets", "reset", "format"]) {
    els[id] = make(id);
  }

  // Only what playground.js actually touches. setTimeout and clearTimeout are
  // already globals in Node, and navigator is read-only there — neither is
  // needed, because the clipboard and selection code lives in site.js.
  const globals = {
    document: {
      body: { dataset: {} },
      getElementById: (id) => els[id] ?? null,
      querySelector: () => null,
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {} },
  };

  const source = bundle.outputFiles[0].text;
  const factory = new Function(
    ...Object.keys(globals),
    `return import(${JSON.stringify(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`,
    )});`,
  );

  // The module reads the globals at import time, so they go on globalThis for
  // the duration of the import rather than being passed in.
  const saved = {};
  for (const [k, v] of Object.entries(globals)) {
    saved[k] = globalThis[k];
    globalThis[k] = v;
  }
  try {
    await factory(...Object.values(globals));
  } finally {
    for (const [k] of Object.entries(globals)) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  }

  return els;
}

test("the playground validates a well-formed filter", async () => {
  const els = await mountPlayground();
  // The default preset is loaded at import time and validated immediately.
  assert.match(els.status.className, /\bok\b/, `status was: ${els.status.className}`);
  assert.match(els.status.textContent, /Valid against the grammar/);
});

test("the built validator agrees with the grammar", async () => {
  const { default: validate } = await import(`${process.cwd()}/dist/validator.js`);

  const valid = [
    { status: "available" },
    { age: { $gt: 18, $lt: 30 } },
    { tags: { $some: { $in: ["a"] } } },
    { price: { $gt: { $field: "cost" } } },
    { status: { $ne: "archived", $unknownAs: true } },
  ];
  const invalid = [
    {},
    { $and: [] },
    { a: { $nope: 1 } },
    { "items[*].qty": { $gt: 2 } },
    { a: { $flags: "i" } },
    { a: { $in: [] } },
    { a: { $in: ["x", "x"] } },
    [],
  ];

  for (const f of valid) assert.ok(validate(f), `should be valid: ${JSON.stringify(f)}`);
  for (const f of invalid) assert.ok(!validate(f), `should be invalid: ${JSON.stringify(f)}`);
});

test("no stray files in dist", async () => {
  const walk = async (dir) => {
    const entries = await readdir(join(OUT, dir), { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walk(p)));
      else out.push(p);
    }
    return out;
  };
  const files = await walk("");
  assert.ok(!files.some((f) => f.startsWith(".tmp")), "the validator's temp dir was published");
  assert.ok(!files.some((f) => f.endsWith(".raw.mjs")), "unbundled validator source was published");
});
