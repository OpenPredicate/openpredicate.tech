/**
 * test-layout.mjs — assert the things only a browser can tell you.
 *
 * test.mjs checks that the right files exist and say the right things. It
 * cannot see that a paragraph is being laid out 200px wider than the phone
 * holding it, because that is a consequence of a grid track's min-content
 * floor, not of the HTML. Each test below stands for a bug that actually
 * shipped:
 *
 *   - a bare `1fr` track let a wide <pre> stretch the column past the viewport
 *   - a fixed `minmax(380px, …)` could not shrink into a 342px container
 *   - the copy button was `opacity: 0` until :hover, which a phone never fires
 *   - four colour pairs sat under 4.5:1, one of them in dark mode only
 *
 *   npm run test:layout
 *
 * Every page is measured once up front and the tests read that snapshot, so
 * the suite costs one navigation per page/viewport rather than one per
 * assertion. Needs Chrome; CHROME_PATH overrides discovery. With no browser at
 * all the suite fails rather than skipping, because a layout test that quietly
 * passes when it never ran is worse than not having one.
 */

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { findChrome, launch } from "./lib/browser.mjs";
import { AUDIT } from "./lib/page-audit.mjs";
import { serve } from "./serve.mjs";

/** Every page the navigation offers, plus one problem page as a representative. */
const PATHS = [
  "/",
  "/guide/",
  "/spec/",
  "/operators/",
  "/playground/",
  "/problems/",
  "/problems/unknown-field/",
  "/schema/",
  "/changelog/",
];

/** 320 is the narrowest phone worth supporting; 768 is where a footer bug hid. */
const WIDTHS = [320, 390, 768, 1280];

/** Colour is checked at both ends: `.gh` only exists above 900px. */
const DARK_WIDTHS = [390, 1280];

/** light[width][path], dark[width][path] */
const light = {};
const dark = {};

let server;
let browser;

before(async () => {
  assert.ok(findChrome(), "No Chrome or Chromium found. Install one, or set CHROME_PATH.");
  server = await serve(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launch(9223);

  const look = (path, opts) => browser.measure(`${origin}${path}`, { expression: AUDIT, ...opts });

  for (const width of WIDTHS) {
    light[width] = {};
    for (const path of PATHS) light[width][path] = await look(path, { width });
  }
  for (const width of DARK_WIDTHS) {
    dark[width] = {};
    for (const path of PATHS) dark[width][path] = await look(path, { width, dark: true });
  }
});

after(async () => {
  await browser?.close();
  // Chrome holds keep-alive sockets, and close() alone waits for them — which
  // would leave the runner hanging after the last assertion.
  server?.closeAllConnections();
  server?.close();
});

/** Every (width, scheme, path) audit, labelled. */
function* everyView() {
  for (const [width, pages] of Object.entries(light)) {
    for (const [path, r] of Object.entries(pages)) yield { label: `${path} at ${width}px`, r };
  }
  for (const [width, pages] of Object.entries(dark)) {
    for (const [path, r] of Object.entries(pages)) {
      yield { label: `${path} at ${width}px dark`, r };
    }
  }
}

test("emulation really applied the viewport it was asked for", () => {
  // Chrome's --window-size silently clamps to 500px. If that ever leaks back
  // in, every width-dependent test below would pass without testing anything.
  for (const width of WIDTHS) {
    assert.equal(light[width]["/"].vw, Number(width), `asked for ${width}px, got a different one`);
  }
});

test("no page scrolls sideways, at any width, in either colour scheme", () => {
  const failures = [];
  for (const { label, r } of everyView()) {
    if (r.docWidth > r.vw + 1) {
      const blame = r.leaks.slice(0, 3).map((l) => `${l.sel} (${l.content}px in ${l.box}px)`);
      failures.push(`${label}: ${r.docWidth - r.vw}px too wide — ${blame.join(", ") || "?"}`);
    }
  }
  assert.deepEqual(failures, [], `pages overflow horizontally:\n  ${failures.join("\n  ")}`);
});

test("text meets WCAG AA contrast, in either colour scheme", () => {
  const failures = [];
  const seen = new Set();
  for (const { label, r } of everyView()) {
    for (const c of r.lowContrast) {
      const key = `${label.split(" at ")[0]}|${c.sel}|${c.colour}|${label.includes("dark")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(
        `${label}: ${c.sel} ${c.ratio}:1 (needs ${c.need}) ${c.colour} at ${c.size}px — "${c.text}"`,
      );
    }
  }
  assert.deepEqual(failures, [], `text below AA contrast:\n  ${failures.join("\n  ")}`);
});

test("controls are at least 24px, the WCAG target minimum", () => {
  const failures = [];
  const seen = new Set();
  for (const { label, r } of everyView()) {
    for (const t of r.smallTargets) {
      const key = `${t.sel}|${t.w}x${t.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(`${label}: ${t.sel} is ${t.w}x${t.h}`);
    }
  }
  assert.deepEqual(failures, [], `controls under 24px:\n  ${failures.join("\n  ")}`);
});

test("hover-revealed controls are restored where there is no hover", () => {
  // A touchscreen never fires :hover, so a control that only appears on hover
  // is simply absent there. The copy button is how a reader gets a filter out
  // of a code block, so this is function, not polish.
  //
  // This reads the parsed stylesheet rather than emulating a touch device,
  // because setEmulatedMedia accepts a `hover` feature and then ignores it —
  // matchMedia('(hover: none)') stays false, so an emulation-based test would
  // pass whether or not the rule existed.
  const failures = [];
  let checked = 0;
  for (const [path, r] of Object.entries(light[390])) {
    for (const c of r.revealOnHover) {
      checked++;
      if (c.opacity === 1) continue; // visible anyway; nothing to restore
      if (!c.restoredWithoutHover) {
        failures.push(`${path}: ${c.sel} is hidden until :hover and no (hover: none) rule shows it`);
      }
    }
  }
  assert.ok(checked > 0, "found no hover-revealed controls at all — has the markup changed?");
  assert.deepEqual(failures, [], `invisible on a touchscreen:\n  ${failures.join("\n  ")}`);
});

test("every page has a sound heading outline, unique ids and named controls", () => {
  const failures = [];
  for (const [path, r] of Object.entries(light[1280])) {
    assert.equal(r.lang, "en", `${path} has no lang on <html>`);
    for (const p of r.headingProblems) failures.push(`${path}: ${p}`);
    for (const id of r.duplicateIds) failures.push(`${path}: duplicate id "${id}"`);
    for (const i of r.imagesWithoutAlt) failures.push(`${path}: <img> without alt — ${i}`);
    for (const l of r.linksWithoutText) failures.push(`${path}: link with no name — ${l}`);
    for (const b of r.buttonsWithoutName) failures.push(`${path}: button with no name — ${b}`);
  }
  assert.deepEqual(failures, [], `document structure problems:\n  ${failures.join("\n  ")}`);
});
