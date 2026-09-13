<img src="./static/assets/logo.svg" alt="" width="76" />

# openpredicate.tech

The public website for the [**OpenPredicate**](https://github.com/OpenPredicate/open-predicate)
specification — an open standard for JSON-encoded predicates.

The site's job is to make the standard discoverable and understandable: say what it is in one
sentence, show it working before asking anyone to read anything, teach the two rules that surprise
people, and then get out of the way of the normative text.

It also does one thing a README cannot. **It serves the schema at its own `$id`**, so
`https://openpredicate.tech/schema/v0.4.0/open-predicate-schema.json` resolves to the file it
identifies, and the `$ref` workflow the spec describes actually works. The RFC 9457 problem-type
URIs resolve too, one page each.

## What is here

| Path | What it is |
| --- | --- |
| `/` | The landing page: what it is, why, the two rules, and the integration points. |
| `/spec/` | The specification, rendered from the vendored `SPEC.md` with a sticky contents sidebar. |
| `/operators/` | Every operator, grouped by profile — **generated from the schema at build time**. |
| `/playground/` | Write a filter, validate it against the real grammar in the browser. |
| `/problems/` | The five error conditions, one dereferenceable page each. |
| `/schema/` | Every published grammar version and its immutable URL. |
| `/changelog/` | The changelog, rendered from the vendored `CHANGELOG.md`. |

## Running it

```bash
npm install
npm start          # build, then serve on http://localhost:4173
npm run build      # render into dist/
npm test           # build, then check the built site
```

Node 22 or newer. `npm test` asserts that every page and asset exists, that no internal link is
dead, that no template expression leaked into the output, that the operator reference covers every
operator in `x-profiles`, and that the playground's validator really accepts and rejects the right
filters.

## How it is built

Plain static HTML, rendered by [`build.mjs`](./build.mjs). No framework, no client-side routing, no
CSS pipeline — a specification site should be readable with JavaScript off, cacheable, and still
legible in ten years. The only script that ships is the playground's.

| File | Role |
| --- | --- |
| [`build.mjs`](./build.mjs) | Renders every page into `dist/`. Fails the build rather than publishing something misleading. |
| [`lib/layout.mjs`](./lib/layout.mjs) | The page shell, and the single source of the site's constants — version, URLs, contact. |
| [`lib/markdown.mjs`](./lib/markdown.mjs) | Renders the vendored spec documents, with GitHub-compatible heading anchors. |
| [`lib/operators.mjs`](./lib/operators.mjs) | Builds the operator reference out of the schema. Throws if an operator in `x-profiles` has no definition. |
| [`lib/validator.mjs`](./lib/validator.mjs) | Compiles the schema into a dependency-free browser validator, and self-checks it. |
| [`lib/highlight.mjs`](./lib/highlight.mjs) | Build-time syntax highlighting for JSON, YAML and HTTP. |
| [`lib/home.mjs`](./lib/home.mjs), [`lib/problems.mjs`](./lib/problems.mjs) | Page content. |

### The site cannot drift from the standard

Three deliberate constraints, because a specification site that contradicts its own specification is
worse than no site:

- **The spec page is the spec.** `/spec/` renders the vendored `SPEC.md` — the normative file — not
  a summary of it.
- **The operator reference is generated.** Descriptions, operand shapes and examples are read out of
  `open-predicate-schema.json` at build time. Nothing is retyped.
- **The playground uses the real grammar.** [`lib/validator.mjs`](./lib/validator.mjs) compiles the
  served schema into a standalone ES module with [Ajv](https://ajv.js.org), bundles it, and runs a
  dozen known-good and known-bad filters through it before the build is allowed to finish. There is
  no third-party script and no runtime CDN.

The build also refuses to publish a schema whose `$id` is not the URL this site serves it at — a
schema published at any other address is a broken pin.

### Updating the vendored spec

The normative documents live in the [specification
repository](https://github.com/OpenPredicate/open-predicate) and are vendored here under
`content/`:

```bash
npm run sync            # from main
npm run sync -- v0.5.0  # from a tag
npm test                # then check the diff
```

Syncing is a separate step from the build on purpose: a build never touches the network, so it is
reproducible and cannot be broken by a push upstream.

## Deploying

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds and publishes to GitHub
Pages on every push to `main`. The custom domain is set by [`CNAME`](./CNAME).

## License

[MIT](./LICENSE), the same as the specification. The logo and wordmark are in
[`static/assets/`](./static/assets).
