/**
 * problems.mjs — a page per error condition.
 *
 * The spec recommends RFC 9457 Problem Details with each condition as a type
 * URI under `https://openpredicate.tech/problems/`. A type URI that 404s is a
 * broken promise, so each one resolves here to the human-readable explanation
 * RFC 9457 says it should.
 */

import { codeBlock } from "./highlight.mjs";
import { SITE } from "./layout.mjs";

export const PROBLEMS = [
  {
    slug: "malformed-query",
    title: "Malformed query",
    summary: "The body does not conform to the grammar.",
    meaning: `The filter is not well-formed OpenPredicate: an unknown operator, an operand of the
      wrong type, or a structural error such as an empty filter object or <code>$and</code> with a
      non-array value. This is the one condition a client can rule out entirely before sending the
      request, by validating against the schema.`,
    fix: `Validate the filter against <a href="${SITE.schemaUrl}">the schema</a> — in CI, in the
      client, or in the <a href="/playground/">playground</a>. Because the grammar is a JSON Schema,
      a generated client can be made unable to construct this error at all.`,
    example: {
      detail: "'$matches' is not an operator in this grammar.",
      pointer: "/filter/$and/0/name/$matches",
    },
    serverShould: `Report the offending clause with a <code>pointer</code>. A client facing a
      deeply nested filter cannot otherwise tell which clause to fix.`,
  },
  {
    slug: "unknown-field",
    title: "Unknown field",
    summary: "The path is well-formed but this endpoint does not expose it.",
    meaning: `The filter names a path the grammar allows but the endpoint does not make queryable —
      a field that does not exist on the resource, or one deliberately withheld. Path syntax is the
      grammar's business; which paths are queryable is the endpoint's.`,
    fix: `Fetch the endpoint's capability document to learn the queryable paths, or generate a
      per-resource filter schema so that unqueryable fields are rejected at validation time rather
      than at runtime.`,
    example: {
      detail: "'birthDate' is not a queryable path on this collection.",
      pointer: "/filter/$and/0/birthDate",
      extra: { queryableFields: ["id", "name", "species", "status", "born", "tags"] },
    },
    serverShould: `Carry a <code>queryableFields</code> member listing the paths it does expose.
      Without it, a client that guessed one name wrong can only guess again.`,
  },
  {
    slug: "unsupported-operator",
    title: "Unsupported operator",
    summary: "The operator is part of the language but not of this endpoint's profiles.",
    meaning: `The operator exists in the grammar and is spelled correctly, but this endpoint does not
      serve it. No implementation is expected to serve all of them: a key-value store cannot
      implement <code>$exists</code>, and a backend with <code>LIKE</code> but no <code>POSITION</code>
      can serve <code>$like</code> and not <code>$contains</code>.`,
    fix: `Read the endpoint's advertised <a href="/operators/">profiles</a> and stay inside them.
      A generated filter schema omits what the server declined, so the client learns this from
      validation instead of from a 400.`,
    example: {
      detail: "$regex is not in this endpoint's advertised profiles (core, strings).",
      pointer: "/filter/$and/1/name/$regex",
      extra: { profiles: ["core", "strings"] },
    },
    serverShould: `Name the profiles it does advertise, so the client can narrow without a second
      round trip.`,
  },
  {
    slug: "invalid-operand",
    title: "Invalid operand",
    summary: "The operator is supported but the operand is not usable.",
    meaning: `The shape is right and the operator is served, but the value cannot be used: a regular
      expression that will not compile, a malformed <code>$like</code> escape, or a value outside the
      field's domain — <code>"Available"</code> where the field admits only
      <code>"available"</code>.`,
    fix: `Check the field's domain in the capability document — its <code>values</code>,
      <code>type</code> or <code>format</code>. A generated filter schema encodes these as enums and
      formats, which turns this class of error into a validation failure.`,
    example: {
      detail: "'Available' is outside the domain of 'status'.",
      pointer: "/filter/status/$eq",
      extra: { accepted: { values: ["available", "pending", "sold"] } },
    },
    serverShould: `Carry an <code>accepted</code> member describing the domain whenever the operand
      was rejected for falling outside it.`,
  },
  {
    slug: "query-too-complex",
    title: "Query too complex",
    summary: "A safety limit was exceeded.",
    meaning: `The filter is valid and every operator in it is served, but it exceeds a limit the
      server publishes — nesting depth, clause count, the size of an operand set, or pattern length.
      Limits exist so that an endpoint accepting arbitrary predicates cannot be turned into a denial
      of service.`,
    fix: `Read the published limits, then split the work: fewer clauses per request, shallower
      nesting, or smaller <code>$in</code> sets across several requests.`,
    example: {
      detail: "Filter nesting depth 12 exceeds the limit of 8.",
      pointer: "/filter/$and/0/$or/3/$and/1",
      extra: { limits: { maxDepth: 8, maxClauses: 64 } },
    },
    serverShould: `State the limit that was hit and its value. "Too complex" without a number
      leaves the client guessing how much to cut.`,
  },
];

function problemJson(problem) {
  return JSON.stringify(
    {
      type: `${SITE.origin}/problems/${problem.slug}`,
      title: problem.title,
      status: 400,
      detail: problem.example.detail,
      pointer: problem.example.pointer,
      ...(problem.example.extra ?? {}),
    },
    null,
    2,
  );
}

export function problemBody(problem) {
  const others = PROBLEMS.filter((p) => p.slug !== problem.slug)
    .map((p) => `<li><a href="/problems/${p.slug}/"><code>${p.slug}</code></a> — ${p.summary}</li>`)
    .join("\n");

  return `
<article class="doc problem">
  <div class="wrap narrow">
    <nav class="crumbs"><a href="/">Home</a> / <a href="/problems/">Errors</a> / <span>${problem.slug}</span></nav>
    <p class="eyebrow">Error condition</p>
    <h1><code>${problem.slug}</code></h1>
    <p class="lede">${problem.summary}</p>

    <dl class="facts">
      <div><dt>Type URI</dt><dd><code>${SITE.origin}/problems/${problem.slug}</code></dd></div>
      <div><dt>HTTP status</dt><dd><code>400 Bad Request</code></dd></div>
      <div><dt>Defined in</dt><dd><a href="/spec/#8-errors">Specification §8</a></dd></div>
    </dl>

    <h2 id="what-it-means">What it means</h2>
    <p>${problem.meaning}</p>

    <h2 id="what-a-client-does">What a client does about it</h2>
    <p>${problem.fix}</p>

    <h2 id="what-a-server-should-send">What a server should send</h2>
    <p>${problem.serverShould}</p>
    ${codeBlock(problemJson(problem), "json", { label: "application/problem+json" })}
    <p class="note">
      The wire format is the API's own. The specification mandates the <em>condition</em>, not this
      envelope: an API with an established error format should express the condition in it rather
      than carry a second format for one endpoint. The member names above are the recommended ones.
    </p>

    <h2 id="the-other-conditions">The other conditions</h2>
    <ul class="plain">${others}</ul>
  </div>
</article>`;
}

export function problemsIndexBody() {
  const rows = PROBLEMS.map(
    (p) => `<tr>
      <td><a href="/problems/${p.slug}/"><code>${p.slug}</code></a></td>
      <td>${p.summary}</td>
    </tr>`,
  ).join("\n");

  return `
<article class="doc">
  <div class="wrap narrow">
    <nav class="crumbs"><a href="/">Home</a> / <span>Errors</span></nav>
    <p class="eyebrow">Error model</p>
    <h1>Five ways a filter can be rejected</h1>
    <p class="lede">
      A rejected filter is answered with <code>400 Bad Request</code>, and the response must say
      which of these conditions applies. Which one it is decides what the client does next — so an
      error that says only "bad request" is not conforming.
    </p>

    <div class="table-scroll"><table>
      <thead><tr><th>Condition</th><th>Meaning</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>

    <h2 id="dereferenceable-types">These URIs resolve on purpose</h2>
    <p>
      Where an API has no established error format, the specification recommends
      <a href="https://www.rfc-editor.org/rfc/rfc9457" rel="noopener">RFC 9457</a> Problem Details
      with each condition as a <code>type</code> URI under
      <code>${SITE.origin}/problems/</code>. RFC 9457 says a type URI should dereference to
      human-readable documentation, so each one above does — a developer pasting the URI from a log
      lands on the explanation.
    </p>

    <h2 id="locating-the-clause">Locating the offending clause</h2>
    <p>
      However it is encoded, an error should carry a <code>pointer</code>: an
      <a href="https://www.rfc-editor.org/rfc/rfc6901" rel="noopener">RFC 6901</a> JSON Pointer into
      the request body. Without one, a client facing a filter with a dozen nested clauses has no way
      to know which to fix. A server must also report the first error it finds rather than partially
      evaluating, and should report all of them when it can.
    </p>
    <p>Full normative text: <a href="/spec/#8-errors">specification §8</a>.</p>
  </div>
</article>`;
}
