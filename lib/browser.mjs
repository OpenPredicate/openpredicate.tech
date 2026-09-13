/**
 * browser.mjs — just enough of the Chrome DevTools Protocol to measure a page.
 *
 * The layout tests need a real engine: viewport width, computed colour and box
 * geometry cannot be asserted from HTML. Hand-rolled rather than pulling in a
 * driver, to keep this repo's dependency list as short as it already is — it is
 * one WebSocket and four commands.
 *
 * Chrome's own `--window-size` silently clamps to 500px, which is useless for a
 * phone-width check, so the viewport is set through Emulation instead. That
 * clamp is the reason these tests exist in this form: a screenshot at
 * `--window-size=390` is not a 390px render, and trusting one hides real bugs.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Where Chrome tends to be. CHROME_PATH wins, which is how CI pins it. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome() {
  return CANDIDATES.find((p) => p && existsSync(p)) ?? null;
}

/**
 * Launch headless Chrome and return a handle with `measure()` and `close()`.
 *
 * @param {number} [port] debugging port; 0 lets Chrome pick one
 */
export async function launch(port = 0) {
  const binary = findChrome();
  if (!binary) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");

  const profile = mkdtempSync(join(tmpdir(), "op-browser-"));
  const child = spawn(
    binary,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // CI containers frequently lack the kernel namespaces Chrome's sandbox
      // wants, and /dev/shm is often tiny. Loosened only there, and only ever
      // pointed at a build this repo just produced.
      ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
      // Chrome writes the chosen port to DevToolsActivePort in the profile, but
      // polling /json/list is simpler and is what tells us it is really up.
      `--remote-debugging-port=${port || 9222}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const base = `http://127.0.0.1:${port || 9222}`;
  let socketUrl = null;
  for (let attempt = 0; attempt < 80 && !socketUrl; attempt++) {
    try {
      const targets = await (await fetch(`${base}/json/list`)).json();
      socketUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!socketUrl) await sleep(125);
  }
  if (!socketUrl) {
    child.kill();
    rmSync(profile, { recursive: true, force: true });
    throw new Error("Chrome started but never exposed a page target");
  }

  const ws = new WebSocket(socketUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error("Could not attach to Chrome"));
  });

  let nextId = 0;
  const pending = new Map();
  const events = new Set();
  ws.onmessage = (message) => {
    const msg = JSON.parse(message.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) {
      events.add(msg.method);
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const id = ++nextId;
      pending.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");

  return {
    /**
     * Load `url` at a given viewport and evaluate `expression` in the page.
     *
     * @param {string} url
     * @param {object} opts
     * @param {number} opts.width    CSS pixels; set through Emulation, not the window
     * @param {number} [opts.height]
     * @param {string} opts.expression an expression whose value is returned
     * @param {boolean} [opts.dark]  emulate prefers-color-scheme: dark
     *
     * There is deliberately no `hover` option: setEmulatedMedia accepts the
     * feature and changes nothing, so `(hover: none)` is verified through the
     * CSSOM in page-audit.mjs instead.
     */
    async measure(url, { width, height = 900, expression, dark = false }) {
      await send("Emulation.setEmulatedMedia", {
        features: dark ? [{ name: "prefers-color-scheme", value: "dark" }] : [],
      });
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
      });

      events.delete("Page.loadEventFired");
      await send("Page.navigate", { url });
      for (let i = 0; i < 60 && !events.has("Page.loadEventFired"); i++) await sleep(50);
      // Fonts and the deferred scripts settle a frame or two after load.
      await sleep(250);

      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(`In-page error: ${exceptionDetails.text}`);
      return result.value;
    },

    async close() {
      try {
        ws.close();
      } catch {}
      // SIGKILL and unref: a lingering Chrome keeps the parent's event loop
      // alive, which would hang the test runner after the last assertion.
      child.kill("SIGKILL");
      child.unref();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
