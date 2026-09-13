/**
 * guide.mjs — "How to design a search API".
 *
 * The site's other pages answer "what is OpenPredicate". Nobody searching for
 * help with a search endpoint types that. This page is written for the
 * question people actually have — where does the filter go, what should it
 * look like, how do I describe it, how do I say no — and answers each with
 * what the specification already decided, linking through rather than
 * restating. Every claim here is traceable to a section of SPEC.md.
 *
 * The FAQ at the end is both real content and the source of the FAQPage
 * structured data, so the answers a crawler quotes are the answers a reader
 * sees. One list, two consumers.
 */

import { codeBlock } from "./highlight.mjs";
import { SITE } from "./layout.mjs";

const REQUEST_BODY = `{
  "filter": {
    "$and": [
      { "status": "available" },
      { "born": { "$gte": "2020-01-01" } }
    ]
  },
  "sort": [{ "field": "born", "direction": "desc" }],
  "limit": 50,
  "cursor": "eyJvZmZzZXQiOjUwfQ"
}`;

const OPENAPI = `paths:
  /pets/search:
    post:
      summary: Search pets
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [filter]
              properties:
                filter:
                  $ref: '${SITE.schemaUrl}'
                limit:
                  type: integer
                  maximum: 200`;

const MCP = `{
  "name": "search_pets",
  "description": "Find pets matching a filter.",
  "inputSchema": {
    "type": "object",
    "required": ["filter"],
    "properties": {
      "filter": { "$ref": "${SITE.schemaUrl}" },
      "limit": { "type": "integer", "maximum": 200 }
    }
  }
}`;

const CAPABILITIES = `{
  "queryLanguage": "${SITE.schemaUrl}",
  "profiles": ["core", "strings", "ranges"],
  "fields": {
    "status": {
      "operators": ["$eq", "$ne", "$in"],
      "type": "string",
      "values": ["available", "pending", "sold"]
    },
    "born": {
      "operators": ["$gt", "$gte", "$lt", "$lte", "$between"],
      "type": "string",
      "format": "date-time"
    }
  }
}`;

const PROBLEM = `HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "${SITE.origin}/problems/unsupported-operator",
  "title": "Unsupported operator",
  "status": 400,
  "detail": "The operator $regex is not served on this endpoint.",
  "pointer": "/filter/$and/1/title/$regex"
}`;

/**
 * The questions, and their answers.
 *
 * Kept as data because they are rendered twice: once as readable prose, once
 * as `FAQPage` JSON-LD. Answers are plain strings with light inline markup, so
 * the structured-data copy can be produced by stripping tags rather than being
 * written a second time and drifting.
 */
export const FAQ = [
  {
    q: "Should search filters go in the query string or the request body?",
    a: `In the body, once the filter can nest. A query string has no natural way to express <code>(a AND b) OR c</code>, so APIs that start there end up inventing a mini-language inside a string — <code>?q=status:open AND born&gt;2020</code> — which no schema can validate and no client can build safely. A JSON body nests for free. The cost is that <code>POST</code> is not obviously cacheable or idempotent, which is exactly the gap <a href="https://www.rfc-editor.org/rfc/rfc10008" rel="noopener">RFC 10008</a>'s <code>QUERY</code> method closes: a method with a body that is safe and cacheable. Use <code>QUERY</code> where you can, <code>POST /…/search</code> where you cannot.`,
  },
  {
    q: "Should a search endpoint be GET or POST?",
    a: `<code>GET</code> for the simple, flat cases — a handful of equality filters that fit in a query string and benefit from HTTP caching. <code>POST /…/search</code> once filters nest or grow past URL length limits. The honest answer is that neither is right, because <code>GET</code> has no body and <code>POST</code> is not safe; <code>QUERY</code> exists because the working group agreed. If you support two, make the filter grammar identical across both so a client does not have to learn twice.`,
  },
  {
    q: "How do I describe a search filter in an OpenAPI document?",
    a: `Point the <code>filter</code> property at a JSON Schema with <code>$ref</code>. If the grammar is one self-contained schema, that is a single line, it validates in CI, and your generated clients get types for it. What you should not do is type the filter as <code>object</code> with no further constraint, or as a <code>string</code> — both mean your document describes the endpoint's shape while saying nothing about the part clients get wrong most.`,
  },
  {
    q: "What should an MCP tool's inputSchema be for a search tool?",
    a: `A JSON Schema that spells out the filter grammar, rather than a free-text <code>query</code> string. A model writing into a typed schema can be told exactly which operators exist and what each one means, and the result can be validated before it reaches your database. A free-text field pushes the parsing problem onto you and gives the model nothing to aim at. Every operator in OpenPredicate carries a <code>description</code>, so those descriptions become the tool's instructions.`,
  },
  {
    q: "How should a search API reject a filter it cannot serve?",
    a: `With <code>400</code>, a machine-readable reason, and a pointer to the clause at fault. "Bad request" with no reason forces the client to guess whether the filter was malformed, referenced an unknown field, or used an operator this endpoint does not serve — three problems with three different fixes. OpenPredicate defines <a href="/problems/">five conditions</a> and recommends <a href="https://www.rfc-editor.org/rfc/rfc9457" rel="noopener">RFC 9457</a> Problem Details with an <a href="https://www.rfc-editor.org/rfc/rfc6901" rel="noopener">RFC 6901</a> JSON Pointer.`,
  },
  {
    q: "How does a client know which fields and operators a search endpoint supports?",
    a: `It has to be told, because no endpoint serves the whole grammar over every field. Publish a capability document — profiles served, and per field the operators and domain allowed. A client can then narrow a filter before sending it, and a model can be handed the same document as context. OpenPredicate makes profiles the unit a server advertises, and accepting only part of a profile is allowed while advertising it in that case is not.`,
  },
  {
    q: "Why does my filter match fewer rows than expected when a field is null?",
    a: `Because comparison against a missing or null field is neither true nor false. OpenPredicate is explicit about this: evaluation is three-valued — TRUE, FALSE, UNKNOWN — and only TRUE matches. So <code>{"status": {"$ne": "archived"}}</code> does not match a record with no <code>status</code> at all, which surprises almost everyone the first time. That is SQL's behaviour too; the difference is that it is written down, and <code>$unknownAs</code> lets a clause opt out deliberately.`,
  },
  {
    q: "Should I write my own filter grammar or adopt one?",
    a: `Writing one is a week; maintaining it is the rest of the project. The parts that look small up front are where the cost is — precedence, null handling, type coercion, a safety limit on nesting depth, an error model precise enough to act on, and a description a client generator can read. If you adopt one, the test is whether it is a plain JSON Schema you can <code>$ref</code>, whether it pins by version, and whether it says what happens when a field is missing.`,
  },
];

const faqHtml = FAQ.map(
  ({ q, a }, i) => `
      <div class="faq-item">
        <h3 id="faq-${i + 1}">${q}</h3>
        <p>${a}</p>
      </div>`,
).join("");

export function guideBody() {
  return `
<article class="doc">
  <div class="wrap narrow">
    <nav class="crumbs"><a href="/">Home</a> / <span>Guide</span></nav>
    <p class="eyebrow">Guide</p>
    <h1>How to design a search API</h1>
    <p class="lede">
      Every search endpoint faces the same five decisions, and most of them get made by accident.
      This is what each one costs, and what the
      <a href="/spec/">OpenPredicate specification</a> settles so you do not have to settle it
      again.
    </p>

    <div class="callout">
      <h2 id="the-decisions">The five decisions</h2>
      <ol>
        <li><a href="#where">Where the filter goes</a> — query string, request body, or a
          <code>QUERY</code> body.</li>
        <li><a href="#grammar">What the filter says</a> — a bespoke string, or a grammar with a
          schema.</li>
        <li><a href="#describe">How it is described</a> — to a developer through OpenAPI, to a model
          through an MCP <code>inputSchema</code>.</li>
        <li><a href="#advertise">What this endpoint actually serves</a> — because none serves the
          whole grammar over every field.</li>
        <li><a href="#reject">How you say no</a> — precisely enough that the client can fix it.</li>
      </ol>
    </div>

    <h2 id="where">1. Where the filter goes</h2>
    <p>
      A query string is fine while filters stay flat. The moment someone needs
      <em>available cats and dogs, or any rescue born since 2020</em>, there is no natural way to
      write that as key–value pairs, and the usual response is to invent a small language inside one
      parameter:
    </p>
    ${codeBlock(`GET /pets?q=status:open AND (species:cat OR tags:rescue)`, "http")}
    <p>
      That string is now an API surface with no schema, no validator and no generated client. The
      alternative is a JSON body, which nests for free and can be described by a schema:
    </p>
    ${codeBlock(REQUEST_BODY, "json", { label: "POST /pets/search" })}
    <p>
      Note what is and is not in there. The <strong>filter</strong> is one member; sorting,
      pagination and limits are siblings. That separation is deliberate — a predicate is the part
      every search endpoint has in common, while result shaping differs per resource. OpenPredicate
      specifies the value of <code>filter</code> and nothing around it, which is what lets one
      grammar serve endpoints whose results have nothing else in common.
    </p>
    <p class="note">
      <strong>On the method.</strong> <code>POST</code> for search is a compromise: it is neither
      safe nor cacheable, which is why intermediaries cannot help you.
      <a href="https://www.rfc-editor.org/rfc/rfc10008" rel="noopener">RFC 10008</a> defines
      <code>QUERY</code> — a method that takes a body and <em>is</em> safe and cacheable. Where your
      stack supports it, it is the right answer; where it does not,
      <code>POST /…/search</code> is the conventional fallback. Keep the body identical between them.
    </p>

    <h2 id="grammar">2. What the filter says</h2>
    <p>
      Once the filter is JSON, it needs a grammar. The parts that decide whether that grammar
      survives contact with a real API are rarely the operators:
    </p>
    <div class="table-scroll"><table>
      <thead><tr><th>The question</th><th>Why it bites later</th></tr></thead>
      <tbody>
        <tr>
          <td>What happens when a field is missing or null?</td>
          <td>Leave it unstated and every implementation picks differently, so the same filter returns
            different rows on different backends.</td>
        </tr>
        <tr>
          <td>How do <code>AND</code> and <code>OR</code> nest?</td>
          <td>Precedence invented per client is precedence argued about in review forever.</td>
        </tr>
        <tr>
          <td>Is <code>"2020-01-01" &gt; 5</code> an error or a false?</td>
          <td>Silent coercion turns a typo into a wrong answer instead of a rejection.</td>
        </tr>
        <tr>
          <td>What bounds nesting depth?</td>
          <td>Without a stated limit, a filter is a denial-of-service vector.</td>
        </tr>
        <tr>
          <td>How does a client know a filter is valid before sending it?</td>
          <td>If the grammar is not a schema, it cannot. Every check moves to your server.</td>
        </tr>
      </tbody>
    </table></div>
    <p>
      OpenPredicate answers these in <a href="/spec/">the specification</a>: evaluation is
      <a href="/spec/#4.1-three-valued-logic">three-valued</a>, so a comparison against a missing
      field is UNKNOWN and only TRUE matches; nesting is explicit rather than precedence-based;
      coercion is defined; and there are
      <a href="/spec/#7.-safety-limits">stated safety limits</a>. The grammar itself is
      <a href="${SITE.schemaUrl}">one JSON Schema file</a> with no dependencies, so a client can
      validate before sending.
    </p>
    <p class="note">
      <strong>The one that surprises everyone.</strong>
      <code>{"status": {"$ne": "archived"}}</code> does <em>not</em> match a record that has no
      <code>status</code> at all. Not-equal against a missing field is UNKNOWN, and UNKNOWN is not a
      match. This is SQL's behaviour; the point of writing it down is that
      <a href="/spec/#4.6-resolving-unknown-unknownas"><code>$unknownAs</code></a> then lets a
      clause opt out on purpose rather than by accident.
    </p>

    <h2 id="describe">3. How it is described</h2>
    <p>
      A search endpoint now has two audiences — developers reading an OpenAPI document, and models
      being handed a tool. Because the grammar is a JSON Schema, both are a <code>$ref</code>.
    </p>

    <h3 id="openapi">In an OpenAPI document</h3>
    <p>
      Reference the schema from the request body. The filter becomes part of the contract: it
      validates in CI, and generated clients get types for the one part users most often get wrong.
    </p>
    ${codeBlock(OPENAPI, "yaml", { label: "OpenAPI 3.1" })}
    <p>
      The failure mode to avoid is typing <code>filter</code> as a bare <code>object</code>, or as a
      <code>string</code> holding a bespoke expression. Either way the document describes the
      envelope and says nothing about the contents.
    </p>

    <h3 id="mcp">As an MCP tool's <code>inputSchema</code></h3>
    <p>
      A tool that takes <code>query: string</code> makes the model guess a syntax and leaves you
      parsing whatever it guessed. A tool whose <code>inputSchema</code> spells out the grammar
      gives the model something to aim at and gives you something to validate against before the
      filter reaches a database.
    </p>
    ${codeBlock(MCP, "json", { label: "MCP tool definition" })}
    <p>
      Every operator in the schema carries a <code>description</code>, so the instructions travel
      with the contract instead of being duplicated into a prompt that drifts. The
      <a href="/operators/">operator reference</a> is generated from those same descriptions — it is
      the grammar describing itself.
    </p>

    <h2 id="advertise">4. What this endpoint actually serves</h2>
    <p>
      No endpoint serves the whole grammar over every field. Regular expressions over an unindexed
      column are a table scan; a date range on a partition key is cheap. So a server has to say
      which slice it serves, and the honest place for that is a capability document rather than
      prose in a wiki.
    </p>
    ${codeBlock(CAPABILITIES, "json", { label: "GET /pets/capabilities" })}
    <p>
      This is what lets a client narrow a filter <em>before</em> sending it, and it is the document
      you hand a model as context. In OpenPredicate the unit a server advertises is the
      <a href="/operators/">profile</a>: <code>core</code> is required of every implementation, the
      rest are optional and named. Serving only part of a profile is allowed — advertising it in
      that case is not.
    </p>

    <h2 id="reject">5. How you say no</h2>
    <p>
      A filter you cannot serve deserves a better answer than <code>400 Bad Request</code>. The
      client's next move depends entirely on <em>why</em>: a malformed filter is a bug to fix, an
      unknown field may be a typo, and an unsupported operator means fall back to a different query.
      Collapsing all three into one status forces a guess.
    </p>
    ${codeBlock(PROBLEM, "http", { label: "RFC 9457 Problem Details" })}
    <p>
      OpenPredicate names <a href="/problems/">five conditions</a> and gives each a type URI that
      dereferences to its own explanation — paste it from a log and you land on the page. The
      <code>pointer</code> is an <a href="https://www.rfc-editor.org/rfc/rfc6901" rel="noopener">RFC
      6901</a> JSON Pointer into the request body, because a client facing a dozen nested clauses
      otherwise has no way to know which one to change.
    </p>

    <h2 id="checklist">A checklist</h2>
    <ul class="checklist">
      <li>The filter is a JSON object in the body, not a bespoke string in a query parameter.</li>
      <li>Filtering is separate from sorting, pagination and projection.</li>
      <li>The grammar is a schema you can <code>$ref</code>, and it is pinned by version.</li>
      <li>Missing-field behaviour is written down, not left to each implementation.</li>
      <li>There is a stated bound on nesting depth and filter size.</li>
      <li>The endpoint publishes which operators and fields it accepts.</li>
      <li>A rejection says which of a known set of conditions applies, and points at the clause.</li>
      <li>The same grammar serves your HTTP API and your agent tooling.</li>
    </ul>
    <p>
      If you would rather not decide all of that yourself, that list is what
      <a href="/spec/">the specification</a> is. You can
      <a href="/playground/">try a filter in the browser</a> against the real grammar, or
      <code>$ref</code> <a href="${SITE.schemaUrl}">the schema</a> and start.
    </p>

    <h2 id="faq">Questions people actually ask</h2>
    <div class="faq">${faqHtml}
    </div>
  </div>
</article>`;
}

/** The same answers as `FAQPage` nodes, with the inline markup stripped. */
export function faqJsonLd(path) {
  const plain = (html) =>
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

  return [
    {
      "@type": "FAQPage",
      "@id": `${SITE.origin}${path}#faq`,
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: plain(a) },
      })),
    },
  ];
}
