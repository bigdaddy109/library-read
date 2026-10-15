/**
 * Static server for the Playwright suite. Serves docs/ under /library-read/
 * like GitHub Pages does (and / for convenience).
 * GET /__test/shell/old switches every response to the previous shell release
 * (cache name and ?v= one lower) until GET /__test/shell/current. A global
 * switch, not a cookie: WebKit sends no cookies on service-worker update checks.
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const BASE = "/library-read";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".epub": "application/epub+zip",
};
const REWRITE = new Set([".html", ".js", ".css", ".webmanifest"]);

export function shellVersion() {
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  return Number(sw.match(/library-read-shell-v(\d+)/)[1]);
}

export function asOldShell(text, version) {
  const old = version - 1;
  return text
    .replaceAll(`library-read-shell-v${version}`, `library-read-shell-v${old}`)
    .replaceAll(`?v=${version}`, `?v=${old}`);
}

let mode = "current";

function resolveFile(urlPath) {
  let path = decodeURIComponent(urlPath.split("?")[0]);
  if (path === BASE) return { redirect: `${BASE}/` };
  if (path.startsWith(`${BASE}/`)) path = path.slice(BASE.length);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return null;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
    return { file };
  } catch {
    return null;
  }
}

const version = shellVersion();
createServer((req, res) => {
  const control = (req.url || "").match(/^\/__test\/shell\/(old|current)$/);
  if (control) {
    mode = control[1];
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(mode);
    return;
  }
  const found = resolveFile(req.url || "/");
  if (found?.redirect) {
    res.writeHead(301, { Location: found.redirect });
    res.end();
    return;
  }
  if (!found) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = extname(found.file);
  let body = readFileSync(found.file);
  const old = mode === "old" && REWRITE.has(ext);
  if (old) body = Buffer.from(asOldShell(body.toString("utf8"), version));
  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Shell": old ? `v${version - 1}` : `v${version}`,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`docs/ on http://127.0.0.1:${PORT}${BASE}/ (shell v${version}; /__test/shell/old → v${version - 1})`);
});
