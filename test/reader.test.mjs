import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CURL_STRIPS,
  alignPage,
  applyCurlStyles,
  curlPose,
  curlRadius,
  fxFromProgress,
  leafAnchor,
  lastStart,
  normalizePrefs,
  pageGeometry,
  releaseDecision,
  settleProgress,
  stepDrag,
  turnTarget,
} from "../docs/reader.js?v=1";
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

function fakeNode() {
  const writes = [];
  return {
    writes,
    style: new Proxy(
      {},
      {
        set(_target, prop, value) {
          writes.push(String(prop));
          return true;
        },
      }
    ),
  };
}

describe("page curl", () => {
  const pageW = 374;
  const pageH = 700;

  it("keeps the grabbed corner on the finger", () => {
    const grabX = pageW;
    const grabY = 640;
    for (const finger of [
      { x: pageW, y: grabY },
      { x: 280, y: 590 },
      { x: 160, y: 420 },
      { x: 40, y: 300 },
    ]) {
      const sample = stepDrag(
        { pageW, pageH, dir: 1, x0: grabX, y0: grabY, leafLeft: 0, grabX },
        { clientX: finger.x, clientY: finger.y }
      );
      assert.equal(sample.edgeGrab, true);
      assert.ok(Math.abs(sample.fx - finger.x) < 0.01, `fx ${sample.fx} vs finger ${finger.x}`);
      const pose = curlPose({ pageW, pageH, fx: sample.fx, bendY: sample.bendY });
      assert.ok(Math.abs(pose.corner.x - finger.x) < 1.5, `corner x ${pose.corner.x} vs ${finger.x}`);
      assert.ok(Math.abs(pose.corner.y - (finger.y - grabY)) < 1.5, `corner y ${pose.corner.y}`);
    }
  });

  it("shows a curled verso and a cast shadow mid-drag", () => {
    const pose = curlPose({ pageW, pageH, fx: pageW * 0.48, bendY: 36 });
    assert.equal(pose.strips.length, CURL_STRIPS);
    assert.equal(pose.backShowing, true);
    assert.equal(pose.flap.opacity, "1");
    assert.ok(Number(pose.flap.shade) > 0.2, "verso shadow");
    assert.match(pose.flap.transform, /rotateY\(-/);
    assert.ok(Number(pose.shadow.opacity) > 0.05, "cast shadow");
    assert.equal(pose.lip.opacity, "1");
    const hidden = pose.strips.filter((s) => s.frontOpacity === "0");
    assert.ok(hidden.length > 0, "peeled text slices drop away");
  });

  it("stays flat at rest and completes across the spine", () => {
    const flat = curlPose({ pageW, pageH, fx: fxFromProgress(0, 1, pageW), bendY: 0 });
    assert.ok(Math.abs(flat.corner.x - pageW) < 1);
    assert.equal(flat.backShowing, false);
    assert.equal(Number(flat.shadow.opacity), 0);
    const done = curlPose({ pageW, pageH, fx: fxFromProgress(1, 1, pageW), bendY: 0 });
    assert.ok(done.corner.x < pageW * 0.08);
    assert.equal(done.backShowing, true);
  });

  it("previous-page progress opens from the spine toward the finger", () => {
    const pageW2 = 600;
    const start = fxFromProgress(0, -1, pageW2);
    const mid = fxFromProgress(0.4, -1, pageW2);
    assert.equal(start, 0);
    assert.ok(Math.abs(mid - pageW2 * 0.4) < 0.01);
    const pose = curlPose({ pageW: pageW2, pageH: 800, fx: mid, bendY: -20 });
    assert.ok(Math.abs(pose.corner.x - mid) < 1.5);
    assert.ok(Math.abs(pose.corner.y - -20) < 0.01);
  });

  it("drag frames write transform and opacity only", () => {
    const strips = [];
    const writes = [];
    for (let i = 0; i < CURL_STRIPS; i += 1) {
      const root = fakeNode();
      const front = fakeNode();
      const back = fakeNode();
      const shade = fakeNode();
      const frontShade = fakeNode();
      strips.push({ root, front, back, shade, frontShade });
      writes.push(root, front, back, shade, frontShade);
    }
    const shadow = fakeNode();
    const flap = fakeNode();
    const flapShade = fakeNode();
    const lip = fakeNode();
    writes.push(shadow, flap, flapShade, lip);
    const nodes = { strips, shadow, flap, flapShade, lip, originX: 390 };
    const radius = curlRadius(pageW);
    assert.ok(radius > 0);
    for (let step = 0; step <= 10; step += 1) {
      const fingerX = pageW - step * 28;
      const sample = stepDrag(
        { pageW, pageH, dir: 1, x0: pageW, y0: 500, leafLeft: 0, grabX: pageW },
        { clientX: fingerX, clientY: 500 - step * 12 }
      );
      applyCurlStyles(nodes, curlPose({ pageW, pageH, fx: sample.fx, bendY: sample.bendY }));
    }
    const allowed = new Set(["transform", "opacity"]);
    for (const node of writes) {
      assert.ok(node.writes.length > 0);
      for (const prop of node.writes) assert.ok(allowed.has(prop), prop);
    }
  });

  it("the per-frame drag path does not read or write layout", () => {
    const src = readFileSync(new URL("../docs/reader.js", import.meta.url), "utf8");
    const extract = (signature) => {
      const at = src.indexOf(signature);
      assert.ok(at > 0, signature);
      const open = src.indexOf("{", at);
      let depth = 0;
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
          depth -= 1;
          if (depth === 0) return src.slice(at, i + 1);
        }
      }
      assert.fail(signature);
    };
    const bodies = [
      "function stepDrag",
      "function curlPose",
      "function applyCurlStyles",
      "queueDrag(d, e) {",
      "paintCurl() {",
    ].map(extract);
    const banned = [
      "getBoundingClientRect",
      "getClientRects",
      "offsetWidth",
      "offsetHeight",
      "offsetLeft",
      "offsetTop",
      "scrollWidth",
      "scrollHeight",
      "clientWidth",
      "clientHeight",
      "getComputedStyle",
      "style.left",
      "style.top",
      "style.width",
      "style.height",
      "style.right",
      "style.bottom",
      "style.margin",
      "style.padding",
    ];
    for (const body of bodies) {
      for (const token of banned) assert.equal(body.includes(token), false, token);
    }
  });
});

describe("page-turn feel", () => {
  const pageW = 600;
  const pageH = 800;

  it("keeps a drag paused until release, then commits, flicks, or springs", () => {
    assert.equal(releaseDecision({ p: 0.1, flick: 0, held: true }), "spring");
    assert.equal(releaseDecision({ p: 0.1, flick: 0.5, held: true }), "spring");
    assert.equal(releaseDecision({ p: 0.1, flick: 0.5, held: false }), "commit");
    assert.equal(releaseDecision({ p: 0.4, flick: 0, held: true }), "commit");
    assert.equal(releaseDecision({ p: 0.28, flick: 0, held: false }), "spring");
    assert.equal(releaseDecision({ p: 0.29, flick: 0, held: false }), "commit");
  });

  it("a short pull is enough; the finger does not cross the whole page", () => {
    const sample = stepDrag(
      { pageW: 374, pageH: 700, dir: 1, x0: 374, y0: 400, leafLeft: 0, grabX: 374 },
      { clientX: 374 - 110, clientY: 400 }
    );
    assert.ok(sample.p > 0.28 && sample.p < 0.5, `p ${sample.p}`);
    assert.equal(releaseDecision({ p: sample.p, flick: 0, held: true }), "commit");
  });

  it("a phone turn still ends at the spine", () => {
    assert.equal(leafAnchor(false, pageW), 0);
    assert.equal(pageGeometry(390, 844).spread, false);
    assert.equal(fxFromProgress(0, 1, pageW), pageW);
    assert.equal(fxFromProgress(1, 1, pageW), 0);
    assert.equal(settleProgress(0.4, { spread: false, dir: 1 }), 0.4);
  });

  it("a desktop spread hinges on the gutter and can cross onto the facing page", () => {
    assert.equal(pageGeometry(1200, 700).spread, true);
    assert.equal(leafAnchor(true, pageW), pageW);
    assert.equal(fxFromProgress(0, 1, pageW, true), pageW);
    assert.equal(fxFromProgress(0.5, 1, pageW, true), 0);
    assert.equal(fxFromProgress(1, 1, pageW, true), -pageW);
    assert.equal(settleProgress(0.4, { spread: true, dir: 1 }), 0.2);
    const held = stepDrag(
      { pageW, pageH, dir: 1, x0: pageW + pageW * 0.9, y0: 400, leafLeft: pageW, grabX: pageW * 0.9, spread: true },
      { clientX: pageW + pageW * 0.55, clientY: 430 }
    );
    assert.equal(held.edgeGrab, true);
    assert.ok(held.fx > 0 && held.p > 0.28 && held.p < 0.6, `fx ${held.fx} p ${held.p}`);
    const pose = curlPose({ pageW, pageH, fx: held.fx, bendY: held.bendY });
    assert.ok(Math.abs(pose.corner.x - held.fx) < 1.5);
    const crossed = stepDrag(
      { pageW, pageH, dir: 1, x0: pageW + pageW * 0.9, y0: 400, leafLeft: pageW, grabX: pageW * 0.9, spread: true },
      { clientX: pageW - 80, clientY: 400 }
    );
    assert.ok(crossed.fx < 0, `fx ${crossed.fx}`);
    assert.ok(crossed.p > 1);
    const over = curlPose({ pageW, pageH, fx: crossed.fx, bendY: 0 });
    assert.ok(over.corner.x < 0);
    assert.match(over.flap.transform, /rotateY\(-/);
    assert.equal(over.flap.opacity, "1");
    const settled = settleProgress(crossed.p, { spread: true, dir: 1 });
    assert.ok(Math.abs(fxFromProgress(settled, 1, pageW, true) - crossed.fx) < 1.5);
  });

  it("快速換頁 is remembered only when chosen; curl stays the default", () => {
    assert.deepEqual(normalizePrefs(null), { font: 1, turn: "curl" });
    assert.deepEqual(normalizePrefs({ font: 2 }), { font: 2, turn: "curl" });
    assert.deepEqual(normalizePrefs({ font: 2, turn: "fast" }), { font: 2, turn: "fast" });
    assert.equal(normalizePrefs({ turn: "slide" }).turn, "curl");
  });
});

describe("content sanitizer lists", () => {
  it("never allows active content", () => {
    for (const tag of ["script", "iframe", "object", "embed", "form", "style", "link"]) {
      assert.ok(DROP_TAGS.has(tag) && !ALLOWED_TAGS.has(tag), tag);
    }
  });
});
