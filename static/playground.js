/**
 * playground.js — validate a filter against the published grammar, in the browser.
 *
 * This is not a simulation. `/validator.js` is compiled at build time from the
 * same `open-predicate-schema.json` this site serves at its `$id`, by a standard
 * validator, so a verdict here is the verdict a conforming server would reach
 * about well-formedness. What it cannot tell you is whether a particular
 * endpoint *serves* the operators you used — that is what profiles and the
 * capability document are for, and the page says so.
 *
 * Nothing is sent anywhere: the filter never leaves the page.
 */

import validate from "/validator.js";

const els = {
  input: document.getElementById("filter-input"),
  status: document.getElementById("status"),
  errors: document.getElementById("errors"),
  presets: document.getElementById("presets"),
  reset: document.getElementById("reset"),
  format: document.getElementById("format"),
};

/**
 * The validator is an ES module generated from the grammar at build time, so
 * there is nothing to fetch or compile and the page works on first paint.
 */
function boot() {
  run();
}

function setStatus(kind, text) {
  els.status.className = `status ${kind}`;
  els.status.textContent = text;
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Ajv reports every branch of an `anyOf` it tried. For a grammar built out of
 * `anyOf` that is mostly noise, so errors are grouped by the location they
 * point at and the deepest, most specific ones are shown first.
 */
function summarise(errors) {
  const byPath = new Map();
  for (const err of errors) {
    const path = err.instancePath || "/";
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(err);
  }

  const entries = [...byPath.entries()].sort((a, b) => b[0].length - a[0].length);

  return entries.slice(0, 6).map(([path, group]) => {
    const keywords = [...new Set(group.map((e) => e.keyword))];
    // Prefer a concrete keyword over the `anyOf` that wraps it.
    const primary = group.find((e) => e.keyword !== "anyOf") ?? group[0];
    return {
      path,
      keyword: primary.keyword,
      message: primary.message ?? "is not valid here",
      params: primary.params,
      keywords,
    };
  });
}

/** What a conforming server would call this, per the error model. */
function conditionFor(summary) {
  if (summary.keyword === "additionalProperties" || summary.keyword === "propertyNames")
    return { slug: "unknown-field", title: "unknown-field" };
  if (summary.keyword === "enum" || summary.keyword === "pattern" || summary.keyword === "type")
    return { slug: "invalid-operand", title: "invalid-operand" };
  return { slug: "malformed-query", title: "malformed-query" };
}

function run() {
  const text = els.input.value;

  if (!text.trim()) {
    setStatus("idle", "Waiting for a filter");
    els.errors.innerHTML = `<p class="hint">Write a filter, or pick an example above.</p>`;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    setStatus("error", "Not JSON yet");
    els.errors.innerHTML = `<div class="err">
      <div class="err-head"><code>malformed-query</code><span class="ptr">before validation</span></div>
      <p>${escape(err.message)}</p>
    </div>`;
    return;
  }

  const ok = validate(parsed);
  if (ok) {
    setStatus("ok", "Valid against the grammar");
    els.errors.innerHTML = `<p class="hint">
      This filter is well-formed OpenPredicate. Whether a given endpoint will <em>serve</em> it is a
      separate question: an operator outside the endpoint's advertised
      <a href="/operators/">profiles</a> earns an
      <a href="/problems/unsupported-operator/"><code>unsupported-operator</code></a>, and a path it
      does not expose earns an <a href="/problems/unknown-field/"><code>unknown-field</code></a>.
    </p>`;
    return;
  }

  setStatus("error", `Rejected — ${validate.errors.length} schema error${validate.errors.length === 1 ? "" : "s"}`);
  els.errors.innerHTML = summarise(validate.errors)
    .map((s) => {
      const condition = conditionFor(s);
      const extra =
        s.keyword === "additionalProperties" && s.params?.additionalProperty
          ? ` <code>${escape(s.params.additionalProperty)}</code>`
          : s.keyword === "enum" && s.params?.allowedValues
            ? ` Allowed: ${s.params.allowedValues.map((v) => `<code>${escape(JSON.stringify(v))}</code>`).join(", ")}.`
            : "";
      return `<div class="err">
        <div class="err-head">
          <a href="/problems/${condition.slug}/"><code>${condition.title}</code></a>
          <span class="ptr">${escape(s.path || "/")}</span>
        </div>
        <p><code>${escape(s.keyword)}</code>: ${escape(s.message)}${extra}</p>
      </div>`;
    })
    .join("");
}

/** Presets double as a tour of the parts people get wrong. */
const PRESETS = {
  "Implicit AND": `{
  "status": "available",
  "species": "cat"
}`,
  "Nested OR": `{
  "$and": [
    { "status": "available" },
    { "$or": [
        { "species": { "$in": ["cat", "dog"] } },
        { "tags": { "$some": { "$in": ["rescue"] } } }
    ]}
  ]
}`,
  "Three-valued logic": `{
  "status": { "$ne": "archived", "$unknownAs": true }
}`,
  "Quantify over an array": `{
  "tags": { "$some": { "$in": ["urgent", "p1"] } },
  "items": { "$every": { "qty": { "$gt": 0 } } }
}`,
  "Compare two fields": `{
  "price": { "$gt": { "$field": "cost" } }
}`,
  "Patterns and ranges": `{
  "name": { "$ilike": "%rex%" },
  "born": { "$between": ["2020-01-01", "2024-12-31"] }
}`,
  "✗ Array membership via $in": `{
  "tags": { "$in": ["rescue"] }
}`,
  "✗ Removed wildcard path": `{
  "items[*].qty": { "$gt": 2 }
}`,
  "✗ Empty filter": `{}`,
};

function mountPresets() {
  els.presets.innerHTML = Object.keys(PRESETS)
    .map(
      (name, i) =>
        `<button type="button" data-preset="${escape(name)}"${i === 1 ? ' class="on"' : ""}>${escape(name)}</button>`,
    )
    .join("");
  els.presets.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-preset]");
    if (!btn) return;
    els.presets.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    els.input.value = PRESETS[btn.dataset.preset];
    run();
    persist();
  });
}

const KEY = "openpredicate:playground";
const persist = () => {
  try {
    localStorage.setItem(KEY, els.input.value);
  } catch {}
};

let timer;
els.input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    run();
    persist();
  }, 180);
});

els.reset.addEventListener("click", () => {
  els.input.value = PRESETS["Nested OR"];
  run();
  persist();
});

els.format.addEventListener("click", () => {
  try {
    els.input.value = JSON.stringify(JSON.parse(els.input.value), null, 2);
    run();
    persist();
  } catch {
    setStatus("error", "Cannot format — not valid JSON");
  }
});

// Tab should indent, not leave the editor.
els.input.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const { selectionStart: s, selectionEnd: end, value } = els.input;
  els.input.value = `${value.slice(0, s)}  ${value.slice(end)}`;
  els.input.selectionStart = els.input.selectionEnd = s + 2;
});

mountPresets();
let restored = null;
try {
  restored = localStorage.getItem(KEY);
} catch {}
els.input.value = restored || PRESETS["Nested OR"];
boot();
