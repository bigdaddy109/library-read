import { copyFileSync, mkdirSync } from "node:fs";
import { SITE, expect, openCover, readerState, shot, startReading, tapNext, test } from "./fixtures.mjs";

const MEDIA = process.env.PAGE_CURL_MEDIA ?? "/cursor/stores/self/media/page-curl-v6";

/** Local review copies. GitHub runners cannot write the agent store, so a denied mkdir must not fail CI. */
function saveShot(src, name) {
  if (!MEDIA) return;
  try {
    mkdirSync(MEDIA, { recursive: true });
    copyFileSync(src, `${MEDIA}/${name}`);
  } catch (err) {
    if (err?.code === "EACCES" || err?.code === "EPERM" || err?.code === "EROFS") return;
    throw err;
  }
}

async function installLayoutTraps(page) {
  await page.evaluate(() => {
    const book = document.getElementById("reader-book");
    const touches = (el) => !!el && (el === book || book.contains(el));
    window.__layoutReads = 0;
    window.__layoutWrites = 0;
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (touches(this)) window.__layoutReads += 1;
      return rect.apply(this, args);
    };
    const rects = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function (...args) {
      if (touches(this)) window.__layoutReads += 1;
      return rects.apply(this, args);
    };
    for (const prop of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "scrollWidth", "scrollHeight", "clientWidth", "clientHeight"]) {
      const host = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
        ? HTMLElement.prototype
        : Element.prototype;
      const desc = Object.getOwnPropertyDescriptor(host, prop);
      if (!desc?.get) continue;
      Object.defineProperty(host, prop, {
        configurable: true,
        get() {
          if (touches(this)) window.__layoutReads += 1;
          return desc.get.call(this);
        },
      });
    }
    for (const prop of ["left", "top", "width", "height", "right", "bottom", "margin", "padding"]) {
      const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
      if (!desc?.set || !desc.get) continue;
      Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
        configurable: true,
        get() {
          return desc.get.call(this);
        },
        set(value) {
          if (touches(this.ownerElement)) window.__layoutWrites += 1;
          desc.set.call(this, value);
        },
      });
    }
  });
}

/** Pointer events on the book, one pointerId. page.mouse stops after setPointerCapture on CI WebKit. */
async function sendPointers(page, events) {
  await page.locator("#reader-book").evaluate((el, events) => {
    for (const ev of events) {
      el.dispatchEvent(
        new PointerEvent(ev.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: ev.x,
          clientY: ev.y,
          button: 0,
          buttons: ev.type === "pointerup" ? 0 : 1,
        })
      );
    }
  }, events);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function stroke(x0, y0, x1, y1, from, to, steps) {
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const k = from + (to - from) * (i / steps);
    points.push({ type: "pointermove", x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k });
  }
  return points;
}

test("page curl follows a corner, keeps the verso shadow, and tap still turns", async ({ page }, testInfo) => {
  await page.goto(SITE);
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect(page.locator("#reader-book")).toContainText("翻");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readerShot = await shot(page, testInfo, "curl-reader");
  saveShot(readerShot, `${testInfo.project.name}-reader.png`);

  const beforeTap = await readerState(page);
  await tapNext(page);
  const afterTap = await readerState(page);
  expect(afterTap.turning).toBe(false);
  expect(afterTap.page + afterTap.spine * 1000).toBeGreaterThan(beforeTap.page + beforeTap.spine * 1000);

  await installLayoutTraps(page);
  const box = await page.locator("#reader-book").boundingBox();
  const x0 = box.x + box.width * 0.93;
  const y0 = box.y + box.height * 0.84;
  const x1 = box.x + box.width * 0.46;
  const y1 = box.y + box.height * 0.4;

  await sendPointers(page, [{ type: "pointerdown", x: x0, y: y0 }, ...stroke(x0, y0, x1, y1, 0, 0.35, 8)]);
  await expect(page.locator("#reader-book.is-turning .curl-root")).toBeVisible();
  const baseline = await page.evaluate(() => ({ reads: window.__layoutReads, writes: window.__layoutWrites }));

  await sendPointers(page, stroke(x0, y0, x1, y1, 0.35, 1, 8));

  const during = await page.evaluate(() => {
    const strips = [...document.querySelectorAll("#reader-book .curl-strip")];
    const flap = document.querySelector("#reader-book .curl-flap");
    const shade = flap?.querySelector(".curl-back-shade");
    const shadow = document.querySelector("#reader-book .turn-shadow");
    const lip = document.querySelector("#reader-book .curl-lip");
    return {
      reads: window.__layoutReads,
      writes: window.__layoutWrites,
      stripCount: strips.length,
      flapOpacity: Number(flap?.style.opacity || 0),
      shade: Number(shade?.style.opacity || 0),
      flapTransform: flap?.style.transform || "",
      lipOpacity: Number(lip?.style.opacity || 0),
      shadowOpacity: Number(shadow?.style.opacity || 0),
      shadowTransform: shadow?.style.transform || "",
      turning: document.getElementById("reader-book").classList.contains("is-turning"),
      paper: !!flap?.classList.contains("is-paper"),
      backImage: getComputedStyle(flap?.querySelector(".curl-back")).backgroundImage,
    };
  });

  expect(during.turning).toBe(true);
  expect(during.stripCount).toBeGreaterThan(4);
  expect(during.reads - baseline.reads, "drag frames must not read layout").toBe(0);
  expect(during.writes - baseline.writes, "drag frames must not write layout").toBe(0);
  expect(during.flapOpacity).toBeGreaterThan(0.9);
  expect(during.shade).toBeGreaterThan(0.2);
  expect(during.lipOpacity).toBeGreaterThan(0.35);
  expect(during.flapTransform).toMatch(/rotateY\(-/);
  expect(during.shadowOpacity).toBeGreaterThan(0.05);
  expect(during.shadowTransform).toContain("translate3d");
  expect(during.paper).toBe(true);
  expect(during.shade).toBeLessThan(0.75);
  expect(during.backImage).toMatch(/gradient/);

  const follow = await page.evaluate(({ x0: sx, y0: sy }) => {
    const book = document.getElementById("reader-book").getBoundingClientRect();
    const root = document.querySelector(".curl-root");
    const flap = document.querySelector(".curl-flap");
    const origin = new DOMMatrix(getComputedStyle(root).transform);
    const local = new DOMMatrix(flap.style.transform);
    return {
      tipX: book.left + origin.e + local.e,
      tipY: book.top + origin.f + local.f,
      startX: sx,
      startY: sy,
    };
  }, { x0, y0, x1, y1 });
  // The peeled tip tracks the finger, not merely the 10px gesture threshold.
  expect(follow.startX - follow.tipX).toBeGreaterThan((x0 - x1) * 0.45);
  expect(follow.startY - follow.tipY).toBeGreaterThan((y0 - y1) * 0.45);

  const midShot = await shot(page, testInfo, "curl-mid-drag");
  saveShot(midShot, `${testInfo.project.name}-mid-drag.png`);

  const beforeRelease = await readerState(page);
  await sendPointers(page, [{ type: "pointerup", x: x1, y: y1 }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const afterRelease = await readerState(page);
  expect(afterRelease.page + afterRelease.spine * 1000).toBeGreaterThan(beforeTap.page + beforeTap.spine * 1000);
  expect(afterRelease.turning).toBe(false);
  void beforeRelease;
});

async function openDemo(page) {
  await page.goto(SITE);
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect(page.locator("#reader-book")).toContainText("翻");
  await tapNext(page);
}

test("an edge drag curls, a short release springs back, a top corner shows paper", async ({ page }, testInfo) => {
  await openDemo(page);
  const box = await page.locator("#reader-book").boundingBox();
  const before = await readerState(page);

  const ex0 = box.x + box.width * 0.92;
  const ey = box.y + box.height * 0.5;
  const ex1 = box.x + box.width * 0.78;
  await sendPointers(page, [{ type: "pointerdown", x: ex0, y: ey }, ...stroke(ex0, ey, ex1, ey, 0, 1, 6)]);
  await page.waitForTimeout(70);
  await sendPointers(page, [{ type: "pointermove", x: ex1 - 2, y: ey }]);
  const edge = await page.evaluate(() => {
    const flap = document.querySelector("#reader-book .curl-flap");
    const shade = flap?.querySelector(".curl-back-shade");
    const shadow = document.querySelector("#reader-book .turn-shadow");
    return {
      turning: document.getElementById("reader-book").classList.contains("is-turning"),
      paper: flap?.classList.contains("is-paper") === true,
      shade: Number(shade?.style.opacity || 0),
      shadow: Number(shadow?.style.opacity || 0),
    };
  });
  expect(edge.turning).toBe(true);
  expect(edge.paper).toBe(true);
  expect(edge.shade).toBeGreaterThan(0.1);
  expect(edge.shadow).toBeGreaterThan(0.05);
  if (testInfo.project.name === "webkit-iphone-390") {
    const edgeShot = await shot(page, testInfo, "curl-edge");
    saveShot(edgeShot, "webkit-iphone-390-edge-mid-drag.png");
  }
  await sendPointers(page, [{ type: "pointerup", x: ex1 - 2, y: ey }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const sprung = await readerState(page);
  expect(sprung.page).toBe(before.page);
  expect(sprung.spine).toBe(before.spine);

  const lx0 = box.x + box.width * 0.08;
  const ly = box.y + box.height * 0.5;
  const lx1 = box.x + box.width * 0.62;
  await sendPointers(page, [{ type: "pointerdown", x: lx0, y: ly }, ...stroke(lx0, ly, lx1, ly, 0, 1, 8)]);
  await expect(page.locator("#reader-book.is-turning .curl-flap.is-paper")).toBeVisible();
  await sendPointers(page, [{ type: "pointerup", x: lx1, y: ly }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const afterLeft = await readerState(page);
  expect(afterLeft.page + afterLeft.spine * 1000).toBeLessThan(before.page + before.spine * 1000);

  const tx0 = box.x + box.width * 0.9;
  const ty0 = box.y + box.height * 0.12;
  const tx1 = box.x + box.width * 0.42;
  const ty1 = box.y + box.height * 0.46;
  await sendPointers(page, [{ type: "pointerdown", x: tx0, y: ty0 }, ...stroke(tx0, ty0, tx1, ty1, 0, 1, 8)]);
  await expect(page.locator("#reader-book.is-turning .curl-flap.is-paper")).toBeVisible();
  const top = await page.evaluate(() => {
    const flap = document.querySelector("#reader-book .curl-flap");
    const shade = flap?.querySelector(".curl-back-shade");
    return {
      transform: flap?.style.transform || "",
      origin: flap?.style.transformOrigin || "",
      shade: Number(shade?.style.opacity || 0),
      shadow: Number(document.querySelector("#reader-book .turn-shadow")?.style.opacity || 0),
    };
  });
  expect(top.transform).toMatch(/rotateZ\(-/);
  expect(top.origin).toContain("0%");
  expect(top.shade).toBeGreaterThan(0.15);
  expect(top.shadow).toBeGreaterThan(0.05);
  if (testInfo.project.name === "webkit-iphone-390") {
    const topShot = await shot(page, testInfo, "curl-top");
    saveShot(topShot, "webkit-iphone-390-top-corner.png");
  }
  await sendPointers(page, [{ type: "pointerup", x: tx1, y: ty1 }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const afterTop = await readerState(page);
  expect(afterTop.page + afterTop.spine * 1000).toBeGreaterThan(afterLeft.page + afterLeft.spine * 1000);
});
