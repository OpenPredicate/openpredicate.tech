/**
 * home.mjs — the landing page.
 *
 * The job of this page, borrowed from the specification sites that do it well:
 * say what the thing is in one sentence, show it working before asking anyone
 * to read anything, then teach the two rules that surprise people. Everything
 * deeper is a link.
 */

import { codeBlock } from "./highlight.mjs";
import { SITE } from "./layout.mjs";

const FILTER_EXAMPLE = `{
  "$and": [
    { "status": "available" },
    { "$or": [
        { "species": { "$in": ["cat", "dog"] } },
        { "tags":    { "$some": { "$in": ["rescue", "senior"] } } }
    ]},
    { "born": { "$gte": "2020-01-01" } }
  ]
}`;

const OPENAPI_EXAMPLE = `paths:
  /pets/search:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                filter:
                  $ref: '${SITE.schemaUrl}'
                limit:
                  type: integer`;

const MCP_EXAMPLE = `{
  "name": "search_pets",
  "description": "Search the pet catalogue.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filter": { "$ref": "${SITE.schemaUrl}" }
    }
  }
}`;

const QUERY_EXAMPLE = `QUERY /pets HTTP/1.1
Host: api.example.com
Content-Type: application/json

{ "filter": { "status": "available" } }`;

const SHORTHAND_BEFORE = `{
  "status": "available",
  "species": "cat"
}`;

const SHORTHAND_AFTER = `{
  "$and": [
    { "status": { "$eq": "available" } },
    { "species": { "$eq": "cat" } }
  ]
}`;

const UNKNOWN_EXAMPLE = `// Does NOT match a pet whose status is absent or null
{ "status": { "$ne": "archived" } }

// Does match them: UNKNOWN is resolved to TRUE
{ "status": { "$ne": "archived", "$unknownAs": true } }`;

const CAPABILITIES_EXAMPLE = `{
  "queryLanguage": "${SITE.schemaUrl}",
  "profiles": ["core", "strings", "ranges", "collections"],
  "fields": {
    "status": { "values": ["available", "pending", "sold"] },
    "born":   { "type": "string", "format": "date" }
  }
}`;

export function homeBody() {
  return `
<section class="hero">
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <img class="hero-logo" src="/assets/logo.svg" alt="" width="88" height="88">
      <h1>Predicates, as JSON.<br>Described by a schema.</h1>
      <p class="lede">
        OpenPredicate is an open standard for the <strong>filter</strong> half of a search API — a
        JSON-encoded, SQL-flavoured predicate language defined by a single JSON Schema. Write the
        grammar once, and every <code>POST /…/search</code>, every <code>QUERY /…</code> and every
        search tool you hand an agent speaks it.
      </p>
      <div class="cta">
        <a class="btn primary" href="/spec/">Read the specification</a>
        <a class="btn" href="/playground/">Try a filter</a>
        <a class="btn ghost" href="${SITE.repo}" rel="noopener">GitHub</a>
      </div>
      <ul class="badges">
        <li>JSON Schema draft 2020-12</li>
        <li>Grammar <code>v${SITE.grammarVersion}</code></li>
        <li>MIT licensed</li>
        <li>No dependencies</li>
      </ul>
    </div>
    <div class="hero-code">
      ${codeBlock(FILTER_EXAMPLE, "json", { label: "Available cats and dogs, or any rescue, born since 2020" })}
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2 class="section-title">Why a standard for this at all</h2>
    <p class="section-lede">
      Search endpoints attract bespoke query syntaxes. Each arrives as an opaque string
      — <code>?q=status:open AND born&gt;2020</code> — that no schema can validate, no generator can
      type, and no client can build safely. Structuring the predicate as JSON changes what the rest
      of your stack can do with it.
    </p>
    <div class="cards three">
      <article class="card">
        <h3>One grammar, every endpoint</h3>
        <p>
          The schema covers the predicate and nothing else — no projection, ordering or pagination.
          That restraint is what makes it reusable: those parts differ per API, the filter does not.
          Clients learn one language instead of one syntax per endpoint.
        </p>
      </article>
      <article class="card">
        <h3>Validated where APIs are already described</h3>
        <p>
          JSON Schema is the interchange format of OpenAPI 3.1 and it is what an MCP
          <code>inputSchema</code> is. So a filter validates in CI, shows up in generated docs, and
          becomes a real type in a generated client — with no new toolchain.
        </p>
      </article>
      <article class="card">
        <h3>Servers say what they cannot do</h3>
        <p>
          No server implements every operator. A server advertises
          <a href="/operators/">profiles</a> and publishes a capability document, so a client learns
          the limits from a schema rather than from a runtime error.
        </p>
      </article>
    </div>
  </div>
</section>

<section class="band alt">
  <div class="wrap">
    <h2 class="section-title">The two rules worth learning first</h2>
    <p class="section-lede">
      Most of the language is guessable. These two are not, and between them they account for nearly
      every surprise. They are normative — <a href="/spec/">the spec</a> pins them down in §4.
    </p>

    <div class="rule">
      <div class="rule-copy">
        <h3><span class="num">1</span> Siblings mean AND. A bare value means equals.</h3>
        <p>
          At every level, sibling members are combined with implicit AND, and a scalar in the value
          position is shorthand for <code>$eq</code>. The two filters on the right are the same
          filter. You only need <code>$and</code> when you want the same field twice, or when you
          are nesting it inside <code>$or</code>.
        </p>
      </div>
      <div class="rule-code">
        ${codeBlock(SHORTHAND_BEFORE, "json", { label: "What you write" })}
        ${codeBlock(SHORTHAND_AFTER, "json", { label: "What it means" })}
      </div>
    </div>

    <div class="rule">
      <div class="rule-copy">
        <h3><span class="num">2</span> Comparison is three-valued, and only TRUE matches.</h3>
        <p>
          A comparison against a field that is <code>null</code> or absent is neither TRUE nor FALSE
          — it is UNKNOWN, and only TRUE matches. So a negation does <em>not</em> sweep up the
          records that have no value at all, which is the SQL behaviour and almost never what someone
          expects the first time.
        </p>
        <p>
          When you do want them, say so with <code>$unknownAs</code>. Making it explicit is the whole
          point: the filter records the decision instead of leaving it to the server.
        </p>
        <table class="truth">
          <caption>Only TRUE matches</caption>
          <thead><tr><th>Field</th><th><code>{"$ne": "archived"}</code></th><th>Matches?</th></tr></thead>
          <tbody>
            <tr><td><code>"open"</code></td><td>TRUE</td><td class="yes">yes</td></tr>
            <tr><td><code>"archived"</code></td><td>FALSE</td><td class="no">no</td></tr>
            <tr><td><code>null</code></td><td>UNKNOWN</td><td class="no">no</td></tr>
            <tr><td>absent</td><td>UNKNOWN</td><td class="no">no</td></tr>
          </tbody>
        </table>
      </div>
      <div class="rule-code">
        ${codeBlock(UNKNOWN_EXAMPLE, "json", { label: "Resolving UNKNOWN explicitly" })}
      </div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2 class="section-title">Two integration points, one schema</h2>
    <p class="section-lede">
      Because the grammar is a JSON Schema, integrating it is a <code>$ref</code>. Both of the
      places an API is described today already speak the format.
    </p>
    <div class="cards two">
      <article class="card code-card">
        <h3>From an OpenAPI document</h3>
        <p>Reference the schema from the request body. It validates in CI and types your clients.</p>
        ${codeBlock(OPENAPI_EXAMPLE, "yaml", { label: "OpenAPI 3.1 · POST /pets/search" })}
      </article>
      <article class="card code-card">
        <h3>As an MCP tool's inputSchema</h3>
        <p>
          The grammar becomes the contract a model writes filters against, with each operator's
          <code>description</code> carried along as the instructions.
        </p>
        ${codeBlock(MCP_EXAMPLE, "json", { label: "MCP tool definition" })}
      </article>
    </div>
    <div class="cards two">
      <article class="card code-card">
        <h3>Or as the body of an HTTP QUERY</h3>
        <p>
          <a href="https://www.rfc-editor.org/rfc/rfc10008" rel="noopener">RFC 10008</a> gives search
          a safe, cacheable method with a body. A predicate is exactly what that body needs to be.
        </p>
        ${codeBlock(QUERY_EXAMPLE, "http", { label: "OpenAPI 3.2 · QUERY /pets" })}
      </article>
      <article class="card code-card">
        <h3>And the server declares its slice</h3>
        <p>
          A capability document states the profiles served and each field's domain, so a client can
          narrow its filters before it sends one.
        </p>
        ${codeBlock(CAPABILITIES_EXAMPLE, "json", { label: "GET /pets/capabilities" })}
      </article>
    </div>
  </div>
</section>

<section class="band alt">
  <div class="wrap">
    <h2 class="section-title">Start where you are</h2>
    <div class="cards three">
      <article class="card link-card">
        <h3><a href="/guide/">How to design a search API</a></h3>
        <p>
          The five decisions behind a search endpoint — where the filter goes, what grammar it
          speaks, how to describe it to developers and to agents, and how to say no — with what this
          specification settles for each.
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="/spec/">Specification</a></h3>
        <p>
          The normative text: the data model, three-valued logic, coercion, every operator's
          semantics, the safety limits and the error model. Versioned and immutable per release.
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="/operators/">Operator reference</a></h3>
        <p>
          Every operator, grouped by the profile that carries it, generated from the schema — so it
          is the grammar's own description of itself, not a retelling.
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="/playground/">Playground</a></h3>
        <p>
          Write a filter, watch it validate against the real schema in your browser, and see the
          error a conforming server would return.
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="/schema/v${SITE.grammarVersion}/open-predicate-schema.json">The schema</a></h3>
        <p>
          One file, no dependencies, served at its own <code>$id</code>. Vendor it or
          <code>$ref</code> it. <code>${SITE.schemaUrl.replace(SITE.origin, "")}</code>
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="/problems/">Error conditions</a></h3>
        <p>
          Five conditions a rejected filter can carry, each with a dereferenceable type URI for
          RFC 9457 Problem Details.
        </p>
      </article>
      <article class="card link-card">
        <h3><a href="${SITE.repo}/blob/main/COMPARISON.md" rel="noopener">Compared with GraphQL</a></h3>
        <p>
          What this overlaps with, what it deliberately does not, and what a JSON-Schema-native
          alternative would still need. The gaps are admitted in writing.
        </p>
      </article>
    </div>
  </div>
</section>

<section class="band status-band">
  <div class="wrap narrow">
    <h2 class="section-title">Honest status</h2>
    <p>
      OpenPredicate is <strong>pre-1.0</strong>. The grammar, the operator set and profile grouping,
      the null and three-valued semantics and the error model are stable enough to review and to
      build against — they are what the schema, the spec and the test suite pin down. The grammar may
      still change before 1.0, and every break is recorded in the
      <a href="/changelog/">changelog</a> with a migration note.
    </p>
    <p>
      Not yet true: the packages are not published to a registry, and this site is the schema's first
      resolvable home. Pin the versioned <code>$id</code>, or vendor the file.
    </p>
    <p class="muted">
      Stewarded by the <a href="${SITE.org}" rel="noopener">OpenPredicate</a> organisation, whose
      purpose is to take this grammar to an open standard and push for its adoption. Disagreement is
      the most useful contribution at this stage —
      <a href="${SITE.repo}/issues" rel="noopener">open an issue</a>.
    </p>
  </div>
</section>
`;
}
