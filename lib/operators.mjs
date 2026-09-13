/**
 * operators.mjs — build the operator reference out of the schema itself.
 *
 * Every description, operand shape and example on the reference page is read
 * from `open-predicate-schema.json`. Nothing is retyped, so the page cannot
 * drift from the grammar it documents, and the build fails if an operator in
 * `x-profiles` has no definition to describe it.
 */

import { codeBlock } from "./highlight.mjs";
import { escapeHtml } from "./layout.mjs";

/** What each profile is for. Profiles are the unit a server advertises. */
export const PROFILE_NOTES = {
  core: "Required of every implementation. Logical composition, equality, ordering, sets, presence, and the resolver that turns UNKNOWN into a decision.",
  strings: "SQL <code>LIKE</code> patterns and literal substring tests.",
  regex: "ECMA-262 regular expressions. Kept apart from <code>strings</code> because a regex engine is a real cost, and a bounded one is a real risk.",
  ranges: "Inclusive two-sided bounds — one clause instead of two.",
  types: "The field's JSON type, for records whose shape is not fixed.",
  collections: "Quantification over the elements of an array-valued field, and its length.",
  refs: "Comparing one field against another, and escaping data that would otherwise be read as an operator.",
  text: "Free-text match. Tokenisation, stemming and relevance are server-defined, so two conforming servers may rank differently.",
};

/** Human labels for the operand definitions an operator can point at. */
const OPERAND_LABELS = {
  Operand: "any JSON value",
  OrderedOperand: "an ordered value",
  ScalarOrNull: "a scalar, or null",
  Bounds: "<code>[lower, upper]</code>",
  OperandSet: "a set of operands",
  SizeConstraint: "a length, or a constraint on it",
  Filter: "a filter",
  ConstraintObject: "a constraint",
  ValueRef: "a field reference",
  LiteralWrapper: "a literal escape",
};

/** Plural forms, for an operator whose operand is an array of something. */
const ARRAY_LABELS = {
  Filter: '<span class="operand">filters</span>',
  Operand: "operands",
  ScalarOrNull: "scalars",
};

function operandOf(schema, defs) {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const label = OPERAND_LABELS[name] ?? name;
    const def = defs[name];
    const title = def?.description ? ` title="${escapeHtml(def.description)}"` : "";
    return `<span class="operand"${title}>${label}</span>`;
  }
  if (schema.anyOf) {
    return schema.anyOf.map((s) => operandOf(s, defs)).join(" <span class=\"or\">or</span> ");
  }
  if (schema.enum) {
    return schema.enum.map((v) => `<code>${escapeHtml(JSON.stringify(v))}</code>`).join(" · ");
  }
  if (schema.type === "array") {
    if (!schema.items) return "an array of values";
    const name = schema.items.$ref?.replace("#/$defs/", "");
    const plural = ARRAY_LABELS[name];
    if (plural) return `an array of ${plural}`;
    return `an array of ${operandOf(schema.items, defs)}`;
  }
  if (schema.type) {
    const extra = schema.pattern ? ` matching <code>${escapeHtml(schema.pattern)}</code>` : "";
    return `<span class="operand">a ${escapeHtml(schema.type)}</span>${extra}`;
  }
  return "—";
}

/**
 * Collect every operator the grammar defines, keyed by name.
 * Operators live in three places, because they apply at three levels.
 */
export function collectOperators(schema) {
  const defs = schema.$defs;
  const out = new Map();

  const add = (name, def, scope) => {
    const entry = {
      name,
      scope,
      description: def.description ?? "",
      operand: operandOf(def, defs),
      examples: def.examples ?? [],
    };
    if (out.has(name)) out.get(name).also = entry;
    else out.set(name, entry);
  };

  for (const [name, def] of Object.entries(defs.Filter.properties ?? {})) add(name, def, "filter");
  for (const [name, def] of Object.entries(defs.ConstraintObject.properties ?? {})) add(name, def, "field");
  add("$field", defs.ValueRef.properties?.$field ?? defs.ValueRef, "operand");
  add("$literal", defs.LiteralWrapper.properties?.$literal ?? defs.LiteralWrapper, "operand");

  // $field and $literal are described by their wrapper, not by the inner property.
  for (const [name, source] of [
    ["$field", defs.ValueRef],
    ["$literal", defs.LiteralWrapper],
  ]) {
    const entry = out.get(name);
    if (entry && !entry.description) entry.description = source.description ?? "";
    if (entry) entry.operand = operandOf(source.properties?.[name] ?? { type: "string" }, defs);
  }

  return out;
}

const SCOPE_LABEL = {
  filter: { text: "filter", title: "Applies to a whole filter, at any level." },
  field: { text: "field", title: "Applies to one field, inside its constraint object." },
  operand: { text: "operand", title: "Appears in the position where a value would go." },
};

/** Render the reference: one section per profile, in the schema's own order. */
export function operatorReference(schema) {
  const operators = collectOperators(schema);
  const profiles = schema["x-profiles"];
  const missing = [];

  const sections = Object.entries(profiles).map(([profile, names]) => {
    const rows = names
      .map((name) => {
        const op = operators.get(name);
        if (!op) {
          missing.push(name);
          return "";
        }
        const scopes = [op.scope, op.also?.scope].filter(Boolean);
        const badges = scopes
          .map((s) => `<span class="scope" title="${escapeHtml(SCOPE_LABEL[s].title)}">${SCOPE_LABEL[s].text}</span>`)
          .join("");
        const operands = [op.operand, op.also?.operand].filter(Boolean);
        const operand = [...new Set(operands)].join(' <span class="or">or</span> ');
        const description = [op.description, op.also?.description]
          .filter(Boolean)
          .map((d) => `<p>${inlineCode(d)}</p>`)
          .join("");
        return `<tr id="op-${name.slice(1)}">
  <td class="op-name"><a href="#op-${name.slice(1)}"><code>${escapeHtml(name)}</code></a>${badges}</td>
  <td class="op-operand">${operand}</td>
  <td class="op-desc">${description}</td>
</tr>`;
      })
      .join("\n");

    return `<section class="profile" id="profile-${profile}">
  <h3><code>${profile}</code><a class="anchor" href="#profile-${profile}" aria-label="Permalink">#</a></h3>
  <p class="profile-note">${PROFILE_NOTES[profile] ?? ""}</p>
  <div class="table-scroll"><table class="operators">
    <thead><tr><th>Operator</th><th>Operand</th><th>Meaning</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>
</section>`;
  });

  if (missing.length) {
    throw new Error(
      `Operators listed in x-profiles but not defined anywhere the reference looks: ${missing.join(", ")}`,
    );
  }

  const examples = schema.$defs.ConstraintObject.examples ?? [];
  const exampleBlock = examples.length
    ? codeBlock(examples.map((e) => JSON.stringify({ field: e }, null, 2)).join("\n"), "json")
    : "";

  return { sections: sections.join("\n"), profiles: Object.keys(profiles), exampleBlock };
}

/**
 * Turn the conventions of the schema's own prose into markup: `$op` names and
 * 'single-quoted' literals become code, and a section reference becomes a link
 * to the spec. The reference is left as text rather than an anchor, because
 * the section numbers are not the spec page's heading ids.
 *
 * JSON snippets are taken out of the text first and put back whole. Without
 * that step, an operator name inside a snippet gets wrapped on its own and the
 * snippet renders as `{" $in ": ["a"]}` — the padding of the code span landing
 * inside the JSON string it is quoting.
 */
export function inlineCode(text) {
  const snippets = [];
  // Braced runs, up to three levels of nesting, which covers every example the
  // schema carries. The placeholder is NUL-delimited so it cannot collide with
  // prose — a bare index would match the "5" in "greater than 5 and".
  const JSON_SNIPPET = /\{[^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*\}/g;

  let out = escapeHtml(text).replace(JSON_SNIPPET, (match) => {
    snippets.push(match);
    return `\u0000${snippets.length - 1}\u0000`;
  });

  out = out
    .replace(/(\$[a-zA-Z]+)/g, "<code>$1</code>")
    .replace(/&#39;([^&]*?)&#39;/g, "<code>$1</code>")
    .replace(/\bSPEC\.md (§[\d.]+)/g, '<a href="/spec/">the spec</a> $1');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${snippets[Number(i)]}</code>`);
}
