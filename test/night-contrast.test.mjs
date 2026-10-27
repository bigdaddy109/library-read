import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../docs/styles.css", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[1];
}

function themeVars(theme) {
  const re = new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`, "g");
  const block = [...css.matchAll(re)].map((m) => m[1]).find((body) => /--flow:/.test(body));
  assert.ok(block, `no --flow variables for ${theme}`);
  return block;
}

describe("night and dim-sepia page contrast", () => {
  it("body text and blockquotes use theme colors instead of a fixed dark brown", () => {
    const flow = rule(".page-flow");
    const quote = rule(".page-flow blockquote");
    assert.match(flow, /color:\s*var\(--flow\)/);
    assert.match(quote, /color:\s*var\(--quote\)/);
    assert.doesNotMatch(flow, /color:\s*#[0-9a-fA-F]{3,8}/);
    assert.doesNotMatch(quote, /color:\s*#[0-9a-fA-F]{3,8}/);
  });

  it("keeps the paper brown in daylight and switches to ink on dark and sepia", () => {
    const root = rule(":root");
    assert.match(root, /--flow:\s*#241c14/);
    assert.match(root, /--quote:\s*#4a3f33/);
    for (const theme of ["dark", "sepia"]) {
      const block = themeVars(theme);
      assert.match(block, /--flow:\s*var\(--ink\)/);
      assert.match(block, /--quote:\s*var\(--muted\)/);
    }
  });
});
