/**
 * site.js — the two small conveniences every page gets.
 *
 * Both are progressive: the copy buttons are inert markup until this runs, and
 * the table of contents is a plain list of links that works without it.
 */

// Copy a code sample.
document.addEventListener("click", async (event) => {
  const button = event.target.closest("figure.code button.copy");
  if (!button) return;
  const code = button.closest("figure.code")?.querySelector("code");
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.innerText);
    button.textContent = "Copied";
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("done");
    }, 1400);
  } catch {
    button.textContent = "Press ⌘C";
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

// Highlight the section currently in view in the table of contents.
const toc = document.querySelector(".toc");
if (toc && "IntersectionObserver" in window) {
  const links = new Map();
  for (const link of toc.querySelectorAll("a[href^='#']")) {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) links.set(target, link);
  }

  let active = null;
  const setActive = (link) => {
    if (link === active) return;
    active?.classList.remove("on");
    link?.classList.add("on");
    active = link;
  };

  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      // The topmost heading still on screen is the one you are reading.
      const first = [...visible].sort((a, b) => a.offsetTop - b.offsetTop)[0];
      if (first) setActive(links.get(first));
    },
    { rootMargin: "-70px 0px -70% 0px", threshold: 0 },
  );

  for (const heading of links.keys()) observer.observe(heading);
}
