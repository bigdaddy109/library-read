import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CURL_STRIPS,
  alignPage,
  applyCurlStyles,
  classifyGrab,
  curlPose,
  curlRadius,
  fxFromProgress,
  lastStart,
  pageGeometry,
  releasePlan,
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
    assert.ok(Number(pose.flap.shade) > 0.2 && Number(pose.flap.shade) < 0.75, "paper verso, not a black slab");
    assert.match(pose.flap.transform, /rotateY\(-/);
    assert.match(pose.flap.transform, /rotateZ\(/);
    assert.ok(Number(pose.shadow.opacity) > 0.05, "cast shadow");
    assert.ok(Number(pose.lip.opacity) > 0.85);
    assert.ok(Number(pose.sheen.opacity) > 0.4, "light on the curl");
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

  it("bends a corner more than a straight edge, and light follows the angle", () => {
    const mid = { pageW, pageH, fx: pageW * 0.5, bendY: -48 };
    const corner = curlPose({ ...mid, corner: "bottom" });
    const edge = curlPose({ ...mid, corner: "middle" });
    const cornerTilt = Number(corner.flap.transform.match(/rotateZ\(([-\d.]+)deg\)/)[1]);
    const edgeTilt = Number(edge.flap.transform.match(/rotateZ\(([-\d.]+)deg\)/)[1]);
    assert.ok(Math.abs(cornerTilt) > Math.abs(edgeTilt) + 4);
    const top = curlPose({ ...mid, bendY: 48, corner: "top" });
    const topTilt = Number(top.flap.transform.match(/rotateZ\(([-\d.]+)deg\)/)[1]);
    assert.ok(topTilt < 0, "a top corner tilts the other way");
    const barely = curlPose({ pageW, pageH, fx: pageW * 0.9, bendY: 6, corner: "bottom" });
    assert.ok(Number(corner.shadow.opacity) > Number(barely.shadow.opacity));
    assert.ok(Number(corner.flap.shade) > Number(barely.flap.shade));
    assert.ok(Number(corner.sheen.opacity) > Number(barely.sheen.opacity));
    assert.ok(Math.abs(Number(corner.flap.transform.match(/rotateY\(([-\d.]+)deg\)/)[1])) > 20);
  });

  it("follows a left edge and a top corner", () => {
    const left = stepDrag(
      { pageW, pageH, dir: -1, x0: 12, y0: 350, leafLeft: 0, grabX: 12, corner: "middle" },
      { clientX: 160, clientY: 350 }
    );
    assert.equal(left.edgeGrab, true);
    assert.ok(Math.abs(left.fx - 160) < 0.01);
    const top = stepDrag(
      { pageW, pageH, dir: 1, x0: pageW * 0.5, y0: 20, leafLeft: 0, grabX: pageW * 0.5, corner: "top" },
      { clientX: 140, clientY: 180 }
    );
    assert.equal(top.edgeGrab, true);
    assert.ok(Math.abs(top.fx - 140) < 0.01);
    assert.ok(top.bendY > 100);
  });

  it("classifies every corner and both side edges", () => {
    assert.deepEqual(classifyGrab({ x: 360, y: 640, width: 390, height: 700, dx: -20, dy: -30 }), { dir: 1, corner: "bottom" });
    assert.deepEqual(classifyGrab({ x: 360, y: 40, width: 390, height: 700, dx: -12, dy: 20 }), { dir: 1, corner: "top" });
    assert.deepEqual(classifyGrab({ x: 16, y: 640, width: 390, height: 700, dx: 20, dy: -10 }), { dir: -1, corner: "bottom" });
    assert.deepEqual(classifyGrab({ x: 16, y: 30, width: 390, height: 700, dx: 10, dy: 10 }), { dir: -1, corner: "top" });
    assert.deepEqual(classifyGrab({ x: 370, y: 350, width: 390, height: 700, dx: -4, dy: 2 }), { dir: 1, corner: "middle" });
    assert.deepEqual(classifyGrab({ x: 14, y: 350, width: 390, height: 700, dx: 4, dy: 1 }), { dir: -1, corner: "middle" });
    assert.equal(classifyGrab({ x: 200, y: 20, width: 390, height: 700, dx: 0, dy: 12 }).corner, "top");
    assert.equal(classifyGrab({ x: 180, y: 680, width: 390, height: 700, dx: 0, dy: -8 }).corner, "bottom");
  });

  it("finishes a long drag and springs a short one back", () => {
    assert.deepEqual(releasePlan({ p: 0.62, vx: 0, dir: 1 }), { target: 1, spring: false });
    assert.deepEqual(releasePlan({ p: 0.22, vx: 0, dir: 1 }), { target: 0, spring: true });
    assert.deepEqual(releasePlan({ p: 0.2, vx: -0.8, dir: 1 }), { target: 1, spring: false });
    assert.deepEqual(releasePlan({ p: 0.6, vx: 0.9, dir: 1 }), { target: 0, spring: true });
    assert.deepEqual(releasePlan({ p: 0.2, vx: 0.8, dir: -1 }), { target: 1, spring: false });
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
    const sheen = fakeNode();
    writes.push(shadow, flap, flapShade, lip, sheen);
    const nodes = { strips, shadow, flap, flapShade, lip, sheen, originX: 390 };
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

describe("content sanitizer lists", () => {
  it("never allows active content", () => {
    for (const tag of ["script", "iframe", "object", "embed", "form", "style", "link"]) {
      assert.ok(DROP_TAGS.has(tag) && !ALLOWED_TAGS.has(tag), tag);
    }
  });
});
