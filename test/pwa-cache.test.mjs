import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const DOCS = new URL("../docs/", import.meta.url).pathname;
const read = (p) => readFileSync(join(DOCS, p), "utf8");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(DOCS, full).split("\\").join("/")];
  });
}

describe("PWA shell cache lockstep", () => {
  const sw = read("sw.js");
  const version = Number(sw.match(/const CACHE = "library-read-shell-v(\d+)";/)?.[1]);
  const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // og-image.png is for link-preview crawlers only; keeping it out of the shell cache saves 250 KB per install.
  const NOT_SHELL = new Set(["og-image.png"]);
  const files = walk(DOCS).filter((f) => !f.endsWith(".nojekyll") && !f.endsWith(".md") && !NOT_SHELL.has(f));

  it("declares an integer shell version", () => {
    assert.ok(Number.isInteger(version) && version > 0);
  });

  it("lists every shipped file exactly once, at the current ?v=", () => {
    const listed = assets.map((a) => a.split("?")[0]);
    assert.equal(new Set(listed).size, listed.length, "duplicate ASSETS entry");
    for (const file of files) {
      if (file === "sw.js") continue;
      assert.ok(listed.includes(`./${file}`), `ASSETS is missing ./${file}`);
    }
    for (const raw of assets) {
      const path = raw.split("?")[0];
      if (path !== "./") assert.ok(files.includes(path.slice(2)), `ASSETS lists missing file ${raw}`);
      const q = raw.match(/\?v=(\d+)$/);
      if (/\.(js|css|svg|png|epub)$/.test(path)) assert.equal(Number(q?.[1]), version, `${raw} is not ?v=${version}`);
    }
  });

  it("every ?v= in index.html, the manifest and module imports matches the cache", () => {
    const sources = ["index.html", "manifest.webmanifest", ...files.filter((f) => f.endsWith(".js") && f !== "sw.js")];
    for (const file of sources) {
      for (const m of read(file).matchAll(/\?v=(\d+)/g)) {
        assert.equal(Number(m[1]), version, `${file} has ?v=${m[1]}, cache is v${version}`);
      }
    }
    for (const file of files.filter((f) => f.endsWith(".js") && f !== "sw.js")) {
      for (const m of read(file).matchAll(/from "(\.[^"]+)"/g)) {
        assert.match(m[1], /\?v=\d+$/, `${file} imports ${m[1]} without ?v=`);
      }
    }
  });

  it("never caches Drive media in the shell cache", () => {
    assert.match(sw, /Cache-Control", "no-store"/);
    assert.ok(!assets.some((a) => a.includes("drive-media")));
  });
});
