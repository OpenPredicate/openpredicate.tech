/**
 * build.mjs — render the site into dist/.
 *
 * No framework and no client-side routing: a specification site should be
 * readable with JavaScript off, cacheable, and still legible in ten years. The
 * only script that ships is the playground's, which genuinely needs one.
 *
 * The build fails rather than publishing something misleading — if an operator
 * has no description, or the schema is missing, it stops.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { page, SITE, escapeHtml } from "./lib/layout.mjs";
import { render, tocHtml } from "./lib/markdown.mjs";
import { operatorReference } from "./lib/operators.mjs";
import { homeBody } from "./lib/home.mjs";
import { PROBLEMS, problemBody, problemsIndexBody } from "./lib/problems.mjs";
import { codeBlock } from "./lib/highlight.mjs";
import { buildValidator, checkValidator } from "./lib/validator.mjs";

const OUT = "dist";
const pages = [];

async function emit(path, html) {
  const file = path.endsWith(".html") ? join(OUT, path) : join(OUT, path, "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  if (!path.endsWith("404.html")) pages.push(path.endsWith(".html") ? `/${path}` : path);
}

/** Repo-relative links in the vendored Markdown should stay on the site where a page exists. */
const rewriteLink = (href) => {
  const map = {
    "./README.md": "/",
    "../README.md": "/",
    "./SPEC.md": "/spec/",
    "./CHANGELOG.md": "/changelog/",
    "../CHANGELOG.md": "/changelog/",
    "./COMPARISON.md": `${SITE.repo}/blob/main/COMPARISON.md`,
    "./LICENSE": `${SITE.repo}/blob/main/LICENSE`,
    "./open-predicate-schema.json": `/schema/v${SITE.grammarVersion}/open-predicate-schema.json`,
  };
  if (map[href]) return map[href];
  // Anything else that points inside the repo goes to the repo.
  if (href.startsWith("./") || href.startsWith("../")) {
    return `${SITE.repo}/blob/main/${href.replace(/^\.\.?\//, "")}`;
  }
  return href;
};

async function buildHome() {
  await emit(
    "/",
    page({
      title: "An open standard for JSON-encoded predicates",
      description: SITE.tagline,
      path: "/",
      heroClass: "home",
      body: homeBody(),
    }),
  );
}

async function buildSpec() {
  const src = await readFile("content/SPEC.md", "utf8");

  // The site supplies its own title, version line and stewardship note in the
  // page header, and the document opens with all three. Start the rendered
  // text at the first sentence that is not repeated, falling back to the whole
  // document if that sentence ever moves.
  const START = "This document defines the semantics";
  const from = src.indexOf(START);
  const body = from === -1 ? src.replace(/^#\s.*\n/, "") : src.slice(from);
  const { html, toc } = render(body, { rewriteLink, tocMin: 2, tocMax: 3 });

  await emit(
    "/spec/",
    page({
      title: "Specification",
      description:
        "The normative specification: data model, three-valued logic, coercion, operator semantics, safety limits and the error model.",
      path: "/spec/",
      heroClass: "has-toc",
      body: `
<div class="wrap doc-layout">
  ${tocHtml(toc, { title: "Contents" })}
  <article class="doc spec">
    <nav class="crumbs"><a href="/">Home</a> / <span>Specification</span></nav>
    <p class="eyebrow">Normative</p>
    <h1>OpenPredicate Specification</h1>
    <p class="lede">
      Version <strong>${SITE.grammarVersion}</strong> · JSON Schema draft 2020-12 ·
      <a href="/schema/v${SITE.grammarVersion}/open-predicate-schema.json">the schema</a>
    </p>
    <p class="note">
      This page is the specification itself, rendered from the same
      <a href="${SITE.repo}/blob/main/SPEC.md" rel="noopener"><code>SPEC.md</code></a> the
      repository ships — not a summary of it. The schema defines the language's <em>shape</em>; this
      document defines what it <em>means</em>.
    </p>
    ${html}
  </article>
</div>`,
    }),
  );
}

async function buildChangelog() {
  const src = await readFile("content/CHANGELOG.md", "utf8");
  const body = src.replace(/^#\s.*\n/, "");
  const { html, toc } = render(body, { rewriteLink, tocMin: 2, tocMax: 2 });

  await emit(
    "/changelog/",
    page({
      title: "Changelog",
      description:
        "Every release of OpenPredicate, with a migration note for each break in the grammar.",
      path: "/changelog/",
      heroClass: "has-toc",
      body: `
<div class="wrap doc-layout">
  ${tocHtml(toc, { title: "Releases" })}
  <article class="doc">
    <nav class="crumbs"><a href="/">Home</a> / <span>Changelog</span></nav>
    <p class="eyebrow">History</p>
    <h1>Changelog</h1>
    <p class="lede">
      Pre-1.0, a minor release may break compatibility. When it does, the break is spelled out here
      with a migration note — that is the deal in exchange for the version number.
    </p>
    ${html}
  </article>
</div>`,
    }),
  );
}

async function buildOperators(schema) {
  const { sections, profiles } = operatorReference(schema);
  const nav = profiles
    .map((p) => `<li><a href="#profile-${p}"><code>${p}</code></a></li>`)
    .join("\n");

  await emit(
    "/operators/",
    page({
      title: "Operator reference",
      description:
        "Every OpenPredicate operator, grouped by the profile that carries it, generated from the schema itself.",
      path: "/operators/",
      body: `
<article class="doc">
  <div class="wrap">
    <nav class="crumbs"><a href="/">Home</a> / <span>Operators</span></nav>
    <p class="eyebrow">Reference</p>
    <h1>Operators, by profile</h1>
    <p class="lede">
      Every operator the grammar defines. The descriptions, operand shapes and examples on this page
      are read out of
      <a href="/schema/v${SITE.grammarVersion}/open-predicate-schema.json">the schema</a> when the
      site is built, so this is the grammar describing itself rather than a retelling that can drift.
    </p>

    <div class="callout">
      <h2>What a profile is for</h2>
      <p>
        A <strong>profile</strong> is the unit a server advertises. <code>core</code> is required of
        every implementation; the rest are optional, and a server states which it serves. Accepting
        part of a profile is permitted — advertising it in that case is not. An operator outside the
        advertised set earns an
        <a href="/problems/unsupported-operator/"><code>unsupported-operator</code></a>, not a
        silent wrong answer.
      </p>
      <ul class="profile-nav">${nav}</ul>
    </div>

    <div class="callout subtle">
      <h2>Reading the operand column</h2>
      <p>
        <span class="scope">filter</span> operators take whole filters and can appear at any level.
        <span class="scope">field</span> operators live inside a field's constraint object.
        <span class="scope">operand</span> forms appear where a value would go. Sibling operators on
        one field are combined with implicit AND, so
        <code>{"age": {"$gt": 18, "$lt": 30}}</code> is a single range.
      </p>
    </div>

    ${sections}

    <div class="callout">
      <h2>Two things the table cannot show</h2>
      <p>
        <strong>Negations are three-valued.</strong> <code>$ne</code>, <code>$nin</code>,
        <code>$nlike</code>, <code>$nbetween</code> and <code>$not</code> do not match records where
        the field is <code>null</code> or absent, because the comparison is UNKNOWN rather than TRUE.
        Add <code>$unknownAs</code> to decide it explicitly.
      </p>
      <p>
        <strong><code>$in</code> is not array membership.</strong> It compares the whole field value
        against each member of the list. To say something about the <em>elements</em> of an array,
        quantify: <code>{"tags": {"$some": {"$in": ["a"]}}}</code>.
      </p>
      <p>Full semantics for every operator: <a href="/spec/#5-operator-semantics">specification §5</a>.</p>
    </div>
  </div>
</article>`,
    }),
  );
}

async function buildPlayground() {
  await emit(
    "/playground/",
    page({
      title: "Playground",
      description:
        "Write an OpenPredicate filter and validate it against the published grammar in your browser.",
      path: "/playground/",
      body: `
<article class="doc playground">
  <div class="wrap">
    <nav class="crumbs"><a href="/">Home</a> / <span>Playground</span></nav>
    <p class="eyebrow">Try it</p>
    <h1>Validate a filter</h1>
    <p class="lede">
      The validator on this page is generated from the very schema this site serves at its
      <code>$id</code>, compiled by <a href="https://ajv.js.org" rel="noopener">Ajv</a> when the site
      was built. It runs entirely in your browser — nothing is sent anywhere, and there is no
      third-party script. A verdict here is the verdict a conforming server would reach about
      well-formedness.
    </p>

    <div id="presets" class="presets" role="group" aria-label="Examples"></div>

    <div class="pg-grid">
      <div class="pg-editor">
        <div class="pg-head">
          <span>Filter</span>
          <div class="pg-actions">
            <button id="format" type="button">Format</button>
            <button id="reset" type="button">Reset</button>
          </div>
        </div>
        <textarea id="filter-input" spellcheck="false" autocapitalize="off" autocomplete="off"
          aria-label="Filter JSON"></textarea>
      </div>
      <div class="pg-result">
        <div class="pg-head"><span>Result</span></div>
        <div id="status" class="status loading">Compiling the grammar…</div>
        <div id="errors" class="errors"></div>
      </div>
    </div>

    <div class="callout subtle">
      <h2>What this does and does not tell you</h2>
      <p>
        It tells you whether a filter is <strong>well-formed</strong> — valid against the grammar.
        It cannot tell you whether a particular endpoint will serve it, because that depends on the
        <a href="/operators/">profiles</a> that endpoint advertises and the paths it exposes. Those
        produce <a href="/problems/unsupported-operator/"><code>unsupported-operator</code></a> and
        <a href="/problems/unknown-field/"><code>unknown-field</code></a>, which no generic
        validator can predict.
      </p>
      <p>
        The three examples marked <span class="x">✗</span> are the mistakes worth making once here
        rather than in production.
      </p>
    </div>
  </div>
</article>`,
      head: `<link rel="modulepreload" href="/playground.js">\n`,
      scripts: `<script type="module" src="/playground.js"></script>`,
    }),
  );
}

async function buildProblems() {
  await emit(
    "/problems/",
    page({
      title: "Error conditions",
      description:
        "The five conditions a rejected OpenPredicate filter can carry, each with a dereferenceable RFC 9457 type URI.",
      path: "/problems/",
      body: problemsIndexBody(),
    }),
  );

  for (const problem of PROBLEMS) {
    await emit(
      `/problems/${problem.slug}/`,
      page({
        title: problem.title,
        description: `${problem.slug} — ${problem.summary}`,
        path: `/problems/${problem.slug}/`,
        body: problemBody(problem),
      }),
    );
  }
}

/** Newest first. */
function byVersionDesc(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

/**
 * Every grammar version vendored under static/schema/, newest first.
 *
 * Read off the filesystem rather than kept by hand: a sync that moves the
 * grammar adds a directory, and the pages that list versions follow without an
 * edit. Every version ever published stays served, because its `$id` is a pin.
 */
async function publishedVersions() {
  return (await readdir("static/schema", { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^v\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name.slice(1))
    .sort(byVersionDesc);
}

async function buildSchemaIndex(schema) {
  const published = await publishedVersions();

  if (!published.includes(SITE.grammarVersion)) {
    throw new Error(
      `The current grammar v${SITE.grammarVersion} has no directory under static/schema/. ` +
        `Run 'npm run sync' to vendor it.`,
    );
  }

  const versions = published.map((version) => ({
    version,
    url: `/schema/v${version}/open-predicate-schema.json`,
    status: version === SITE.grammarVersion ? "Current" : "Superseded",
    note:
      version === SITE.grammarVersion
        ? `The grammar as of release ${SITE.releaseVersion}.`
        : "Superseded, and still served at its original URL.",
  }));

  const rows = versions
    .map(
      (v) => `<tr>
      <td><code>v${v.version}</code></td>
      <td><a href="${v.url}"><code>${SITE.origin}${v.url}</code></a></td>
      <td>${v.status}</td>
      <td>${v.note}</td>
    </tr>`,
    )
    .join("\n");

  await emit(
    "/schema/",
    page({
      title: "The schema",
      description:
        "Every published version of the OpenPredicate grammar, each immutable at its own versioned URL.",
      path: "/schema/",
      body: `
<article class="doc">
  <div class="wrap narrow">
    <nav class="crumbs"><a href="/">Home</a> / <span>Schema</span></nav>
    <p class="eyebrow">Artefacts</p>
    <h1>The schema, by version</h1>
    <p class="lede">
      The grammar is one JSON Schema file with no dependencies. Its <code>$id</code> carries the
      version, each release is served at its own URL, and a published URL is immutable. Consumers
      pin by <code>$id</code>.
    </p>

    <div class="table-scroll"><table>
      <thead><tr><th>Version</th><th>URL</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>

    <h2 id="how-to-use-it">How to use it</h2>
    <p>
      <code>$ref</code> the versioned URL, or vendor the file and reference your copy — both are
      supported, and vendoring is the safer default for a build that must not depend on this host.
      The version in the <code>$id</code> tracks the <em>grammar</em>, not the repository &mdash;
      release <code>v${SITE.releaseVersion}</code> serves grammar
      <code>v${SITE.grammarVersion}</code>, because a release that ships tooling or naming changes
      leaves the <code>$id</code> where it is.
    </p>
    ${codeBlock(
      `curl -O ${SITE.schemaUrl}`,
      "http",
      { label: "Vendor it" },
    )}

    <h2 id="versioning">What a version bump means</h2>
    <ul class="plain">
      <li><strong>Patch</strong> — documentation and description text only.</li>
      <li><strong>Minor</strong> — new optional operators or profiles. A filter valid under <code>v0.N</code> stays valid under <code>v0.N+1</code>.</li>
      <li><strong>Major</strong> — anything that can invalidate an existing filter.</li>
    </ul>
    <p>
      Before 1.0 a minor release may break compatibility; each break is recorded in the
      <a href="/changelog/">changelog</a> with a migration note. Normative text:
      <a href="/spec/#9-versioning">specification §9</a>.
    </p>

    <h2 id="title">What is in the file</h2>
    <p>
      <code>${escapeHtml(schema.title)}</code> — ${escapeHtml(schema.description.split(".")[0])}.
      It defines ${Object.keys(schema.$defs).length} definitions and
      ${Object.values(schema["x-profiles"]).flat().length} operators across
      ${Object.keys(schema["x-profiles"]).length} profiles.
    </p>
  </div>
</article>`,
    }),
  );
}

async function buildNotFound() {
  await emit(
    "404.html",
    page({
      title: "Not found",
      description: "That page does not exist.",
      path: "/404.html",
      body: `
<article class="doc">
  <div class="wrap narrow center-block">
    <p class="eyebrow">404</p>
    <h1>No such page</h1>
    <p class="lede">
      If you arrived from a <code>type</code> URI in an error response, the condition may be
      mis-spelled — the five valid ones are on the <a href="/problems/">errors page</a>.
    </p>
    <p>
      Otherwise: the <a href="/spec/">specification</a>, the
      <a href="/operators/">operator reference</a>, the <a href="/playground/">playground</a>, or
      <a href="/">the front page</a>.
    </p>
  </div>
</article>`,
    }),
  );
}

async function buildMeta() {
  const urls = pages
    .map((p) => `  <url><loc>${SITE.origin}${p === "/" ? "/" : p}</loc></url>`)
    .join("\n");
  await writeFile(
    join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
  );
  await writeFile(
    join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.origin}/sitemap.xml\n`,
  );

  // Netlify reads _headers from the publish directory. It is generated rather
  // than declared in netlify.toml because that file cannot scope headers to a
  // deploy context, and because the schema's rules must follow the versions
  // that actually exist.
  //
  // The site ships no inline script, no inline style, no event handler
  // attribute and no third-party origin, so it can carry a policy this strict.
  // Anything that later needs this relaxed is a sign something was pulled in
  // that the site had deliberately done without.
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  const global = [
    `Content-Security-Policy: ${csp}`,
    // The schema is served as application/schema+json, a type browsers have no
    // handler for; nosniff stops one being guessed at.
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
  ];

  // Netlify noindexes deploy previews on its own, but the most recent branch
  // deploy stays indexable — and a branch deploy of this site is a full second
  // copy of a specification, which must not compete with the real one. CONTEXT
  // is set by Netlify and absent locally, and a local build should look like
  // production, so only an explicitly non-production context opts in.
  const context = process.env.CONTEXT;
  if (context && context !== "production") global.push("X-Robots-Tag: noindex");

  // The schema needs three things a static host does not give it by default:
  // the media type a $ref consumer expects, CORS — it is fetched cross-origin
  // by browser tooling — and an immutable cache, which is safe precisely
  // because a published $id never changes.
  const schemaRules = (await publishedVersions()).map(
    (v) => `/schema/v${v}/open-predicate-schema.json
  Content-Type: application/schema+json; charset=utf-8
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable`,
  );

  await writeFile(
    join(OUT, "_headers"),
    `${[`/*\n${global.map((h) => `  ${h}`).join("\n")}`, ...schemaRules].join("\n\n")}\n`,
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const schemaPath = `static/schema/v${SITE.grammarVersion}/open-predicate-schema.json`;
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));

  if (schema.$id !== SITE.schemaUrl) {
    throw new Error(
      `The schema's $id (${schema.$id}) is not the URL this site serves it at (${SITE.schemaUrl}). ` +
        `A schema published at an address other than its own $id is a broken pin.`,
    );
  }

  await cp("static", OUT, { recursive: true });

  // The playground's validator, compiled from the schema above.
  const { bytes } = await buildValidator(schema, join(OUT, "validator.js"));
  const checked = await checkValidator(join(OUT, "validator.js"));
  console.log(`validator: ${(bytes / 1024).toFixed(0)} kB, ${checked} checks passed`);

  await buildHome();
  await buildSpec();
  await buildOperators(schema);
  await buildPlayground();
  await buildProblems();
  await buildSchemaIndex(schema);
  await buildChangelog();
  await buildNotFound();
  await buildMeta();

  console.log(`built ${pages.length} pages into ${OUT}/`);
  for (const p of pages) console.log(`  ${p}`);
}

await main();
