import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../docs/styles.css", import.meta.url), "utf8");

function menuHtml() {
  const match = html.match(/<div id="reader-menu"[\s\S]*?<\/div>/);
  assert.ok(match, "reader menu is missing");
  return match[1] ? match[0] : match[0];
}

describe("narrow reader bar", () => {
  it("keeps 返回、書名、目錄 on the bar and moves the rest into 更多", () => {
    const top = html.match(/<header class="reader-top">([\s\S]*?)<\/header>/)[1];
    assert.match(top, /id="reader-back"/);
    assert.match(top, /id="reader-title"/);
    assert.match(top, /id="reader-toc"/);
    assert.match(top, /id="reader-more"[^>]*>更多</);
    const menu = menuHtml();
    for (const id of ["reader-reauth", "reader-font", "reader-theme", "reader-turn"]) {
      assert.match(menu, new RegExp(`id="${id}"`));
    }
    assert.match(menu, /重新授權/);
    assert.match(menu, /快速換頁/);
    const beforeMenu = top.slice(0, top.indexOf('id="reader-menu"'));
    assert.doesNotMatch(beforeMenu, /id="reader-font"/);
    assert.doesNotMatch(beforeMenu, /id="reader-theme"/);
    assert.doesNotMatch(beforeMenu, /id="reader-turn"/);
    assert.doesNotMatch(beforeMenu, /id="reader-reauth"/);
  });

  it("gives every reader control a 44px box and hides the menu until 更多", () => {
    const ghost = css.match(/\.reader-top \.ghost \{([^}]+)\}/)[1];
    assert.match(ghost, /min-width:\s*44px/);
    assert.match(ghost, /min-height:\s*44px/);
    assert.match(css, /@media \(max-width: 400px\)/);
    assert.match(css, /\.reader-tools\.is-open \.reader-menu \{[^}]*display:\s*flex/);
    assert.match(css, /#reader-more \{\s*display:\s*none/);
    assert.match(css, /\.reader-top \.ghost:hover \{[^}]*color:\s*var\(--ink\)/);
  });
});
