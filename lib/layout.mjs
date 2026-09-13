/**
 * layout.mjs — the page shell every page on the site shares.
 *
 * One function, so the header, navigation, footer and metadata exist once.
 * Pages supply a title, a description and a body; everything else is derived.
 */

import { readFileSync } from "node:fs";

/**
 * What the last sync pulled in, written by sync.mjs. The versions are derived
 * from the artefacts themselves — the grammar from the schema's `$id`, the
 * release from the tag — rather than typed here, so they cannot drift from the
 * vendored specification without a test noticing.
 */
const SPEC = JSON.parse(
  readFileSync(new URL("../content/spec-version.json", import.meta.url), "utf8"),
);

export const SITE = {
  name: "OpenPredicate",
  origin: "https://openpredicate.tech",
  tagline:
    "One JSON Schema for the filter half of a search API — $ref it from an OpenAPI document, or inline it as an MCP tool's inputSchema.",
  repo: "https://github.com/OpenPredicate/open-predicate",
  org: "https://github.com/OpenPredicate",
  email: "contact@openpredicate.tech",
  /** The grammar version, which is what the schema `$id` carries. */
  grammarVersion: SPEC.grammar,
  /** The release version of the repository and its tooling. */
  releaseVersion: SPEC.release,
};

SITE.schemaUrl = `${SITE.origin}/schema/v${SITE.grammarVersion}/open-predicate-schema.json`;

const NAV = [
  { href: "/guide/", label: "Guide" },
  { href: "/spec/", label: "Specification" },
  { href: "/operators/", label: "Operators" },
  { href: "/playground/", label: "Playground" },
  { href: "/problems/", label: "Errors" },
  { href: "/changelog/", label: "Changelog" },
];

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/**
 * The sitewide nodes: who publishes this, and what the site is.
 *
 * Expressed as a single `@graph` with stable `@id`s so the per-page nodes can
 * point at these rather than restating them. This is what lets a search engine
 * or a crawling agent tell that /spec/ and /operators/ are parts of one work
 * with one publisher, instead of eight unrelated documents.
 */
const ORGANISATION = `${SITE.origin}/#organisation`;
const WEBSITE = `${SITE.origin}/#website`;

function siteNodes() {
  return [
    {
      "@type": "Organization",
      "@id": ORGANISATION,
      name: SITE.name,
      url: SITE.origin,
      logo: `${SITE.origin}/assets/logo-512.png`,
      email: SITE.email,
      sameAs: [SITE.org, SITE.repo],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE,
      name: SITE.name,
      url: SITE.origin,
      description: SITE.tagline,
      inLanguage: "en",
      license: `${SITE.repo}/blob/main/LICENSE`,
      publisher: { "@id": ORGANISATION },
    },
  ];
}

/**
 * The nodes describing one page: the document itself, and its trail.
 *
 * `TechArticle` rather than `WebPage` because that is what these are, and it
 * is the type that carries `dependencies` and `proficiencyLevel` honestly.
 */
function pageNodes({ title, description, path, canonical }) {
  if (path === "/") return [];
  return [
    {
      "@type": "TechArticle",
      "@id": `${canonical}#article`,
      headline: title,
      description,
      url: canonical,
      inLanguage: "en",
      isPartOf: { "@id": WEBSITE },
      publisher: { "@id": ORGANISATION },
      license: `${SITE.repo}/blob/main/LICENSE`,
      about: {
        "@type": "Thing",
        name: "Search API filter grammar",
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.origin },
        { "@type": "ListItem", position: 2, name: title, item: canonical },
      ],
    },
  ];
}

/** JSON-LD in a <script> must not be able to close it early. */
const jsonLdScript = (nodes) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": nodes,
  }).replace(/</g, "\\u003c")}</script>\n`;

/**
 * Wrap a body in the site shell.
 *
 * @param {object} page
 * @param {string} page.title      document title, without the site suffix
 * @param {string} page.description meta description, one sentence
 * @param {string} page.path       absolute site path, for canonical URL and nav state
 * @param {string} page.body       the page's HTML
 * @param {string} [page.heroClass] extra class for <body>, for per-page tweaks
 * @param {string} [page.head]     extra markup for <head>
 * @param {string} [page.scripts]  extra markup before </body>
 * @param {object[]} [page.jsonLd] extra schema.org nodes for this page
 */
export function page({
  title,
  description,
  path,
  body,
  heroClass = "",
  head = "",
  scripts = "",
  jsonLd = [],
}) {
  const canonical = `${SITE.origin}${path}`;
  const fullTitle = path === "/" ? `${SITE.name} — ${title}` : `${title} · ${SITE.name}`;
  const nav = NAV.map((item) => {
    const active = path === item.href || (item.href !== "/" && path.startsWith(item.href));
    return `<a href="${item.href}"${active ? ' aria-current="page"' : ""}>${item.label}</a>`;
  }).join("\n        ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/logo-192.png">
<link rel="stylesheet" href="/styles.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE.origin}/assets/logo-512.png">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/schema+json" href="${SITE.schemaUrl}">
<link rel="alternate" type="text/markdown" href="${SITE.origin}/llms.txt" title="Site summary for language models">
${jsonLdScript([...siteNodes(), ...pageNodes({ title: fullTitle, description, path, canonical }), ...jsonLd])}${head}</head>
<body class="${heroClass}" data-schema-url="${SITE.schemaUrl}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">
      <img src="/assets/logo.svg" alt="" width="30" height="30">
      <span><strong>Open</strong>Predicate</span>
    </a>
    <nav aria-label="Main">
        ${nav}
    </nav>
    <a class="gh" href="${SITE.repo}" rel="noopener">GitHub</a>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="/">
        <img src="/assets/logo.svg" alt="" width="26" height="26">
        <span><strong>Open</strong>Predicate</span>
      </a>
      <p class="muted">${escapeHtml(SITE.tagline)}</p>
      <p class="muted small">Specification and site are <a href="${SITE.repo}/blob/main/LICENSE">MIT</a>-licensed.
      Grammar <code>v${SITE.grammarVersion}</code> · release <code>v${SITE.releaseVersion}</code> · pre-1.0.</p>
    </div>
    <div>
      <h2>Specification</h2>
      <ul>
        <li><a href="/guide/">Designing a search API</a></li>
        <li><a href="/spec/">Read the spec</a></li>
        <li><a href="/operators/">Operator reference</a></li>
        <li><a href="/problems/">Error conditions</a></li>
        <li><a href="/schema/v${SITE.grammarVersion}/open-predicate-schema.json">The JSON Schema</a></li>
      </ul>
    </div>
    <div>
      <h2>Project</h2>
      <ul>
        <li><a href="${SITE.repo}">Repository</a></li>
        <li><a href="/changelog/">Changelog</a></li>
        <li><a href="${SITE.repo}/issues">Issues &amp; discussion</a></li>
        <li><a href="${SITE.org}">The OpenPredicate org</a></li>
        <li><a href="mailto:${SITE.email}">${SITE.email}</a></li>
      </ul>
    </div>
  </div>
</footer>
<script src="/site.js" defer></script>
${scripts}</body>
</html>
`;
}

export { escapeHtml };
