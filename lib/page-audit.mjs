/**
 * page-audit.mjs — the measurements taken inside the browser.
 *
 * `audit` is written as an ordinary function so it stays readable and
 * lint-able, then serialised for the DevTools Protocol by `AUDIT`. It must be
 * self-contained: nothing it references survives the trip to the page.
 *
 * What it does NOT check is as deliberate as what it does. Inline links in a
 * sentence are exempt from the 24px target minimum (WCAG 2.5.8), so only real
 * controls are measured; and contrast is computed against composited
 * background *colours*, so an element whose only background is a gradient is
 * judged against the nearest solid colour behind it.
 */

/* eslint-env browser */
export function audit() {
  const vw = document.documentElement.clientWidth;
  const px = (n) => Math.round(n);
  const name = (el) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : "") +
    (typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "");

  // ---- colour ----------------------------------------------------------
  // Chrome serialises color-mix() as `color(srgb 0.9 0.9 0.9 / 0.86)`, whose
  // components are 0-1, not 0-255. Reading those as 0-255 turns white into
  // near-black and invents contrast failures that are not there.
  const toRgba = (value) => {
    if (!value || value === "transparent") return [0, 0, 0, 0];
    const parts = value.match(/[-\d.]+/g);
    if (!parts) return null;
    const unit = /^color\(|srgb/.test(value) ? 255 : 1;
    const [r, g, b] = parts.slice(0, 3).map((n) => Number(n) * unit);
    return [r, g, b, parts.length > 3 ? Number(parts[3]) : 1];
  };
  const composite = (top, bottom) => {
    const a = top[3];
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1,
    ];
  };
  const backdrop = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const colour = toRgba(getComputedStyle(node).backgroundColor);
      if (colour && colour[3] > 0) layers.push(colour);
    }
    let out = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = composite(layers[i], out);
    return out;
  };
  const luminance = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (fg, bg) => {
    const [a, b] = [luminance(fg), luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  // ---- horizontal overflow --------------------------------------------
  // The page-level number is the one that matters: docWidth > vw means the
  // reader has to pan sideways to read a paragraph. `leaks` names the box that
  // caused it, so a failure says where to look.
  const leaks = [];
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && style.overflowX === "visible") {
      leaks.push({ sel: name(el), content: el.scrollWidth, box: el.clientWidth });
    }
  }

  // ---- contrast --------------------------------------------------------
  const lowContrast = [];
  const seenPair = new Set();
  const TEXT = "p,a,span,li,td,th,h1,h2,h3,h4,h5,h6,code,button,label,small,strong,em,dt,dd";
  for (const el of document.querySelectorAll(TEXT)) {
    const text = el.textContent.trim();
    if (!text) continue;
    // Skip wrappers whose text belongs to a child; the child is measured.
    if ([...el.children].some((c) => c.textContent.trim() === text)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (Number(style.opacity) === 0) continue;
    const fg = toRgba(style.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const ratio = contrast(fg[3] < 1 ? composite(fg, bg) : fg, bg);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    if (ratio >= need) continue;
    const key = `${name(el)}|${style.color}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    lowContrast.push({
      sel: name(el),
      ratio: Math.round(ratio * 100) / 100,
      need,
      colour: style.color,
      size: px(size),
      text: text.slice(0, 40),
    });
  }

  // ---- target size, for controls only ---------------------------------
  const CONTROLS = "button,input,select,textarea,a.anchor,a.btn,a.gh";
  const smallTargets = [];
  for (const el of document.querySelectorAll(CONTROLS)) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.height < 24 || r.width < 24) {
      smallTargets.push({ sel: name(el), w: px(r.width), h: px(r.height) });
    }
  }

  // ---- controls that only exist on hover ------------------------------
  // These are hidden until :hover, which a touchscreen never fires. The
  // DevTools Protocol cannot emulate `(hover: none)` — setEmulatedMedia
  // accepts the feature and changes nothing, so asking matchMedia about it
  // proves nothing. Instead the stylesheet is read back as the browser parsed
  // it: find the `(hover: none)` rules that restore opacity, then ask each
  // control whether it is actually matched by one.
  const restoreSelectors = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet; none of ours are
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSMediaRule)) continue;
      if (!/hover\s*:\s*none/.test(rule.conditionText)) continue;
      for (const inner of rule.cssRules) {
        if (inner.selectorText && inner.style?.opacity === "1") {
          restoreSelectors.push(inner.selectorText);
        }
      }
    }
  }
  const revealOnHover = [...document.querySelectorAll(".anchor, figure.code button.copy")].map(
    (el) => ({
      sel: name(el),
      opacity: Number(getComputedStyle(el).opacity),
      restoredWithoutHover: restoreSelectors.some((s) => el.matches(s)),
    }),
  );

  // ---- document structure ---------------------------------------------
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent.trim().slice(0, 50),
  }));
  const headingProblems = [];
  const h1s = headings.filter((h) => h.level === 1).length;
  if (h1s !== 1) headingProblems.push(`expected exactly one h1, found ${h1s}`);
  for (let i = 1; i < headings.length; i++) {
    const jump = headings[i].level - headings[i - 1].level;
    if (jump > 1) {
      headingProblems.push(
        `h${headings[i - 1].level} jumps to h${headings[i].level} at "${headings[i].text}"`,
      );
    }
  }

  const counts = {};
  const duplicateIds = [];
  for (const el of document.querySelectorAll("[id]")) {
    counts[el.id] = (counts[el.id] ?? 0) + 1;
    if (counts[el.id] === 2) duplicateIds.push(el.id);
  }

  return {
    path: location.pathname,
    title: document.title,
    lang: document.documentElement.lang || null,
    vw,
    docWidth: document.documentElement.scrollWidth,
    leaks,
    lowContrast,
    smallTargets,
    revealOnHover,
    headingProblems,
    duplicateIds,
    imagesWithoutAlt: [...document.querySelectorAll("img")]
      .filter((i) => !i.hasAttribute("alt"))
      .map(name),
    linksWithoutText: [...document.querySelectorAll("a")]
      .filter(
        (a) =>
          !a.textContent.trim() &&
          !a.getAttribute("aria-label") &&
          !a.querySelector('img[alt]:not([alt=""])'),
      )
      .map((a) => `${name(a)} href=${a.getAttribute("href")}`),
    buttonsWithoutName: [...document.querySelectorAll("button")]
      .filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.title)
      .map(name),
  };
}

/** The same function, packaged for Runtime.evaluate. */
export const AUDIT = `(${audit.toString()})()`;
