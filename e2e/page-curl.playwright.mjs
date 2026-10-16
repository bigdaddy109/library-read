import { copyFileSync, mkdirSync } from "node:fs";
import { SITE, expect, openCover, readerState, shot, startReading, tapNext, test } from "./fixtures.mjs";

const MEDIA = process.env.PAGE_CURL_MEDIA ?? "/cursor/stores/self/media/page-curl";

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

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    await page.mouse.move(x0 + (x1 - x0) * k * 0.35, y0 + (y1 - y0) * k * 0.35);
    await page.waitForTimeout(20);
  }
  await expect(page.locator("#reader-book.is-turning .curl-root")).toBeVisible();
  await page.waitForTimeout(40);
  const baseline = await page.evaluate(() => ({ reads: window.__layoutReads, writes: window.__layoutWrites }));

  for (let i = 1; i <= 8; i += 1) {
    const k = 0.35 + 0.65 * (i / 8);
    await page.mouse.move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    await page.waitForTimeout(32);
  }
  await page.waitForTimeout(80);

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
    };
  });

  expect(during.turning).toBe(true);
  expect(during.stripCount).toBeGreaterThan(4);
  expect(during.reads - baseline.reads, "drag frames must not read layout").toBe(0);
  expect(during.writes - baseline.writes, "drag frames must not write layout").toBe(0);
  expect(during.flapOpacity).toBeGreaterThan(0.9);
  expect(during.shade).toBeGreaterThan(0.2);
  expect(during.lipOpacity).toBeGreaterThan(0.9);
  expect(during.flapTransform).toMatch(/rotateY\(-/);
  expect(during.shadowOpacity).toBeGreaterThan(0.05);
  expect(during.shadowTransform).toContain("translate3d");

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
  // The peeled tip moved with the finger (left and up from the grabbed corner).
  expect(follow.tipX).toBeLessThan(follow.startX - 8);
  expect(follow.tipY).toBeLessThan(follow.startY - 8);

  const midShot = await shot(page, testInfo, "curl-mid-drag");
  saveShot(midShot, `${testInfo.project.name}-mid-drag.png`);

  const beforeRelease = await readerState(page);
  await page.mouse.up();
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const afterRelease = await readerState(page);
  expect(afterRelease.page + afterRelease.spine * 1000).toBeGreaterThan(beforeTap.page + beforeTap.spine * 1000);
  expect(afterRelease.turning).toBe(false);
  void beforeRelease;
});
