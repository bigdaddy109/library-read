import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignPage, lastStart, pageGeometry, turnTarget } from "../docs/reader.js?v=1";
import { ALLOWED_TAGS, DROP_TAGS } from "../docs/content.js?v=1";

describe("page geometry", () => {
  it("one page on an iPhone, step = page width", () => {
    const g = pageGeometry(374, 700);
    assert.equal(g.spread, false);
    assert.equal(g.step, 374);
    assert.equal(g.colW + g.gap, g.step);
    assert.equal(g.viewportW, g.colW);
  });

  it("two-page spread on a wide desktop box", () => {
    const g = pageGeometry(1200, 700);
    assert.equal(g.spread, true);
    assert.equal(g.pageW, 600);
    assert.equal(g.viewportW, 2 * g.colW + g.gap);
  });

  it("portrait iPad stays single page", () => {
    assert.equal(pageGeometry(810, 1000).spread, false);
  });
});

describe("turn targets", () => {
  const at = (o) => ({ spineIndex: 1, page: 0, pages: 5, spineCount: 3, spread: false, ...o });

  it("moves within a chapter, then across chapters, then stops at the ends", () => {
    assert.deepEqual(turnTarget(at({ page: 2 }), 1), { spineIndex: 1, page: 3 });
    assert.deepEqual(turnTarget(at({ page: 4 }), 1), { spineIndex: 2, page: 0 });
    assert.deepEqual(turnTarget(at({ page: 0 }), -1), { spineIndex: 0, page: "end" });
    assert.equal(turnTarget(at({ spineIndex: 2, page: 4 }), 1), null);
    assert.equal(turnTarget(at({ spineIndex: 0, page: 0 }), -1), null);
  });

  it("spreads move two pages and start on even pages", () => {
    assert.deepEqual(turnTarget(at({ spread: true, page: 0 }), 1), { spineIndex: 1, page: 2 });
    assert.deepEqual(turnTarget(at({ spread: true, page: 4 }), 1), { spineIndex: 2, page: 0 });
    assert.equal(alignPage(3, true), 2);
    assert.equal(lastStart(5, true), 4);
    assert.equal(lastStart(4, true), 2);
  });
});

describe("content sanitizer lists", () => {
  it("never allows active content", () => {
    for (const tag of ["script", "iframe", "object", "embed", "form", "style", "link"]) {
      assert.ok(DROP_TAGS.has(tag) && !ALLOWED_TAGS.has(tag), tag);
    }
  });
});
