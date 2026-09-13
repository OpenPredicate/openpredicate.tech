/**
 * serve.mjs — a local static server for dist/, for previewing a build.
 *
 * It resolves clean URLs the way GitHub Pages does (`/spec/` → `/spec/index.html`)
 * and falls back to `404.html`, so what you see locally is what gets published.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = "dist";
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** The schema is served as schema+json, which is what a $ref consumer expects. */
function contentType(path) {
  if (path.endsWith("-schema.json")) return "application/schema+json; charset=utf-8";
  return TYPES[extname(path)] ?? "application/octet-stream";
}

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const candidates = clean.endsWith("/")
    ? [join(ROOT, clean, "index.html")]
    : [join(ROOT, clean), join(ROOT, clean, "index.html"), join(ROOT, `${clean}.html`)];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const file = (await resolve(req.url)) ?? join(ROOT, "404.html");
  const status = file.endsWith("404.html") && !req.url.includes("404") ? 404 : 200;
  res.writeHead(status, { "content-type": contentType(file), "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`openpredicate.tech → http://localhost:${PORT}`);
});
