import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const DOCS = new URL("../docs/", import.meta.url).pathname;
export const SITE = "https://bigdaddy109.github.io/library-read/";

function htmlPages(dir = DOCS) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return htmlPages(full);
    return name.endsWith(".html") ? [relative(DOCS, full).split("\\").join("/")] : [];
  });
}

function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/\b(?:property|name)\s*=\s*"([^"]+)"/i)?.[1];
    if (name === key) return tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  }
  return null;
}

/** Width/height from the PNG IHDR chunk. */
export function pngSize(bytes) {
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", "not a PNG");
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("share previews (Open Graph + Twitter)", () => {
  const pages = htmlPages();

  it("finds the site's HTML pages", () => {
    assert.ok(pages.includes("index.html"));
  });

  for (const page of pages) {
    describe(page, () => {
      const html = readFileSync(join(DOCS, page), "utf8");

      it("has every required tag", () => {
        for (const key of ["og:title", "og:description", "og:image", "og:image:width", "og:image:height", "twitter:card"]) {
          assert.ok(metaContent(html, key), `${page} is missing ${key}`);
        }
        assert.equal(metaContent(html, "og:image:width"), "1200");
        assert.equal(metaContent(html, "og:image:height"), "630");
        assert.equal(metaContent(html, "twitter:card"), "summary_large_image");
      });

      it("uses Traditional Chinese title and description", () => {
        assert.match(metaContent(html, "og:title"), /書架/);
        assert.match(metaContent(html, "og:description"), /電子書/);
      });

      it("points og:image (and twitter:image, og:url) at absolute Pages URLs", () => {
        for (const key of ["og:image", "twitter:image", "og:url"]) {
          const value = metaContent(html, key);
          if (value == null) continue;
          assert.ok(value.startsWith(SITE), `${page} ${key} must start with ${SITE}: ${value}`);
        }
      });

      it("og:image exists in docs/ and is a 1200×630 PNG", () => {
        const rel = metaContent(html, "og:image").slice(SITE.length).split("?")[0];
        const file = join(DOCS, rel);
        assert.ok(existsSync(file), `${rel} is not in docs/`);
        assert.deepEqual(pngSize(readFileSync(file)), { width: 1200, height: 630 });
      });
    });
  }
});
