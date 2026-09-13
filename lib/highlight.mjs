/**
 * highlight.mjs — build-time syntax highlighting.
 *
 * Highlighting happens here rather than in the browser: the code samples are
 * the substance of a specification site, so they should be readable before any
 * JavaScript runs, and there is no reason to ship a highlighter to do it.
 *
 * Three small tokenisers cover everything the site shows: JSON (the filters),
 * YAML (the OpenAPI fragments) and HTTP (the request/response examples).
 */

import { escapeHtml } from "./layout.mjs";

const span = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;

/**
 * JSON. Operator keys — the `$`-prefixed ones — are highlighted apart from
 * ordinary field names, because the difference between them is exactly what a
 * reader is trying to learn.
 */
export function highlightJson(src) {
  let out = "";
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === '"') break;
        else j++;
      }
      const raw = src.slice(i, j + 1);
      // A string followed by a colon is a key.
      const rest = src.slice(j + 1);
      const isKey = /^\s*:/.test(rest);
      const inner = raw.slice(1, -1);
      if (isKey) out += span(inner.startsWith("$") ? "t-op" : "t-key", raw);
      else out += span("t-str", raw);
      i = j + 1;
      continue;
    }

    if (/[-\d]/.test(ch) && /^-?\d/.test(src.slice(i))) {
      const m = src.slice(i).match(/^-?\d+(\.\d+)?([eE][-+]?\d+)?/);
      out += span("t-num", m[0]);
      i += m[0].length;
      continue;
    }

    const word = src.slice(i).match(/^(true|false|null)\b/);
    if (word) {
      out += span("t-lit", word[0]);
      i += word[0].length;
      continue;
    }

    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += span("t-com", src.slice(i, stop));
      i = stop;
      continue;
    }

    if ("{}[]".includes(ch)) {
      out += span("t-brace", ch);
      i++;
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }
  return out;
}

/** YAML, enough for the OpenAPI fragments: keys, strings, comments, refs. */
export function highlightYaml(src) {
  return src
    .split("\n")
    .map((line) => {
      const comment = line.match(/^(\s*)(#.*)$/);
      if (comment) return escapeHtml(comment[1]) + span("t-com", comment[2]);

      let out = "";
      const kv = line.match(/^(\s*-?\s*)([\w$.\-/]+)(:)(.*)$/);
      if (kv) {
        const [, indent, key, colon, value] = kv;
        out += escapeHtml(indent) + span(key.startsWith("$") ? "t-op" : "t-key", key) + span("t-brace", colon);
        const inlineComment = value.match(/^(.*?)(\s+#.*)$/);
        const body = inlineComment ? inlineComment[1] : value;
        if (/^\s*['"]/.test(body)) out += span("t-str", body);
        else if (/^\s*(true|false|null)\s*$/.test(body)) out += span("t-lit", body);
        else if (/^\s*-?\d+(\.\d+)?\s*$/.test(body)) out += span("t-num", body);
        else out += escapeHtml(body);
        if (inlineComment) out += span("t-com", inlineComment[2]);
        return out;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

/** HTTP request and response lines. */
export function highlightHttp(src) {
  return src
    .split("\n")
    .map((line) => {
      const request = line.match(/^([A-Z]{3,7})(\s+)(\S+)(\s+)(HTTP\/[\d.]+)$/);
      if (request)
        return (
          span("t-op", request[1]) +
          request[2] +
          span("t-str", request[3]) +
          request[4] +
          span("t-lit", request[5])
        );

      const status = line.match(/^(HTTP\/[\d.]+)(\s+)(\d{3})(\s+.*)$/);
      if (status)
        return span("t-lit", status[1]) + status[2] + span("t-num", status[3]) + escapeHtml(status[4]);

      const header = line.match(/^([\w-]+)(:)(.*)$/);
      if (header) return span("t-key", header[1]) + span("t-brace", header[2]) + escapeHtml(header[3]);

      return escapeHtml(line);
    })
    .join("\n");
}

const LANGS = {
  json: highlightJson,
  yaml: highlightYaml,
  yml: highlightYaml,
  http: highlightHttp,
};

/** Render a fenced code block as highlighted, copyable markup. */
export function codeBlock(src, lang = "json", { label } = {}) {
  const body = (LANGS[lang] ?? escapeHtml)(src.replace(/\n$/, ""));
  const head = label ? `<div class="code-label">${escapeHtml(label)}</div>` : "";
  return `<figure class="code" data-lang="${escapeHtml(lang)}">${head}<pre><code>${body}</code></pre><button class="copy" type="button" aria-label="Copy to clipboard">Copy</button></figure>`;
}
