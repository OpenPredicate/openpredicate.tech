/**
 * markdown.mjs — render the vendored specification documents to HTML.
 *
 * The spec is authored as Markdown in the specification repository and is the
 * normative text; the site renders that same file rather than a retelling of
 * it, so the two cannot disagree. Headings get stable anchors and a table of
 * contents is collected on the way through.
 */

import { Marked } from "marked";
import { codeBlock } from "./highlight.mjs";
import { escapeHtml } from "./layout.mjs";

/** GitHub-compatible heading slugs, so links from the repo keep working. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s§.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.+$/, "");
}

/**
 * Render Markdown, returning the HTML and a flat table of contents.
 *
 * @param {string} src
 * @param {object} [opts]
 * @param {(href: string) => string} [opts.rewriteLink] map repo-relative links onto site paths
 * @param {number} [opts.tocMin] shallowest heading level to include in the TOC
 * @param {number} [opts.tocMax] deepest heading level to include in the TOC
 */
export function render(src, { rewriteLink = (h) => h, tocMin = 2, tocMax = 3 } = {}) {
  const toc = [];
  const seen = new Map();

  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, "");
        let id = slug(plain);
        if (seen.has(id)) {
          const n = seen.get(id) + 1;
          seen.set(id, n);
          id = `${id}-${n}`;
        } else {
          seen.set(id, 0);
        }
        if (depth >= tocMin && depth <= tocMax) toc.push({ id, depth, text: plain });
        return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Permalink to this section">#</a></h${depth}>\n`;
      },

      code({ text, lang }) {
        return codeBlock(text, (lang || "json").trim().split(/\s+/)[0]);
      },

      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = rewriteLink(href);
        const external = /^https?:/.test(target) && !target.startsWith("https://openpredicate.tech");
        const attrs = [
          `href="${escapeHtml(target)}"`,
          title ? `title="${escapeHtml(title)}"` : "",
          external ? 'rel="noopener"' : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<a ${attrs}>${text}</a>`;
      },

      table({ header, rows }) {
        const head = header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const body = rows
          .map((row) => `<tr>${row.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("\n");
        return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>\n`;
      },
    },
  });

  return { html: marked.parse(src), toc };
}

/** Render a table of contents as a nested-looking, flat list. */
export function tocHtml(toc, { title = "On this page" } = {}) {
  if (!toc.length) return "";
  const items = toc
    .map((h) => `<li class="lvl-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join("\n");
  return `<nav class="toc" aria-label="${escapeHtml(title)}">
  <h2>${escapeHtml(title)}</h2>
  <ul>
${items}
  </ul>
</nav>`;
}
