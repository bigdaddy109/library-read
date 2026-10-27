import { copyFileSync, mkdirSync } from "node:fs";
import { SITE, expect, openCover, readerState, startReading, test } from "./fixtures.mjs";

const MEDIA = process.env.PAGE_TURN_MEDIA ?? "/cursor/stores/self/media/page-turn-v8";

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

/** Step the curl by hand so a jumped WebKit clock cannot finish the turn before the screenshot. */
async function manualFrames(page) {
  await page.evaluate(() => {
    const real = window.requestAnimationFrame.bind(window);
    const queue = [];
    window.__rafReal = real;
    window.requestAnimationFrame = (fn) => {
      queue.push(fn);
      return queue.length;
    };
    window.__rafQueue = queue;
    window.__sawTurning = false;
    const book = document.getElementById("reader-book");
    new MutationObserver(() => {
      if (book.classList.contains("is-turning")) window.__sawTurning = true;
    }).observe(book, { attributes: true, attributeFilter: ["class"] });
  });
}

async function stepFrames(page, count) {
  await page.evaluate((count) => {
    let now = window.__t0 || performance.now();
    for (let i = 0; i < count; i += 1) {
      const batch = window.__rafQueue.splice(0, window.__rafQueue.length);
      now += 16;
      for (const fn of batch) fn(now);
    }
    window.__t0 = now;
  }, count);
}

async function releaseFrames(page) {
  await page.evaluate(() => {
    const queue = window.__rafQueue.splice(0, window.__rafQueue.length);
    window.requestAnimationFrame = window.__rafReal;
    let now = performance.now();
    const run = () => {
      const fn = queue.shift();
      if (!fn) return;
      now += 16;
      fn(now);
      if (queue.length) window.requestAnimationFrame(run);
    };
    if (queue.length) window.requestAnimationFrame(run);
  });
}

async function dispatchPointers(page, events) {
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
    window.__t0 = performance.now();
  }, events);
}

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

function stroke(x0, y0, x1, y1, steps) {
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    points.push({ type: "pointermove", x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k });
  }
  return points;
}

async function openSample(page) {
  await page.goto(SITE);
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect(page.locator("#reader-book")).toContainText("翻");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function metrics(page) {
  return page.evaluate(() => {
    const book = document.getElementById("reader-book");
    const rect = book.getBoundingClientRect();
    const root = book.querySelector(".curl-root");
    const flap = book.querySelector(".curl-flap");
    const matrix = root ? new DOMMatrix(getComputedStyle(root).transform) : null;
    return {
      spread: book.classList.contains("is-spread"),
      hinge: book.dataset.hinge || "",
      turning: book.classList.contains("is-turning"),
      fast: book.classList.contains("is-fast"),
      page: Number(book.dataset.page),
      spine: Number(book.dataset.spine),
      rootX: matrix ? matrix.e : null,
      bookW: rect.width,
      flap: flap?.style.transform || "",
      curl: !!root,
    };
  });
}

async function grab(page, progress) {
  const box = await page.locator("#reader-book").boundingBox();
  const spread = (await metrics(page)).spread;
  const pageW = spread ? box.width / 2 : box.width;
  const leaf = spread ? pageW : 0;
  const y = box.y + box.height * 0.72;
  const xAt = (p) => box.x + leaf + pageW * (1 - p);
  return { box, spread, pageW, y, x0: xAt(0.02), xAt };
}

test("a mid-drag pause holds the page, and a past-threshold release finishes", async ({ page }, testInfo) => {
  await openSample(page);
  const phone = testInfo.project.name === "webkit-iphone-390";
  const start = await readerState(page);
  const g = await grab(page, 0.45);
  if (phone) {
    expect(g.spread).toBe(false);
    expect((await metrics(page)).hinge).toBe("edge");
  }
  await sendPointers(page, [{ type: "pointerdown", x: g.x0, y: g.y }, ...stroke(g.x0, g.y, g.xAt(0.45), g.y, 8)]);
  const held = await metrics(page);
  expect(held.turning).toBe(true);
  expect(held.curl).toBe(true);
  expect(held.page).toBe(start.page);
  if (phone) expect(Math.abs(held.rootX)).toBeLessThan(2);
  await page.waitForTimeout(350);
  const still = await metrics(page);
  expect(still.turning).toBe(true);
  expect(still.page).toBe(start.page);
  expect(still.flap).toBe(held.flap);
  if (phone) {
    await page.screenshot({ path: testInfo.outputPath("mid-drag-pause.png") });
    saveShot(testInfo.outputPath("mid-drag-pause.png"), "webkit-iphone-390-mid-drag-pause.png");
  }
  await sendPointers(page, [{ type: "pointerup", x: g.xAt(0.45), y: g.y }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const after = await readerState(page);
  expect(after.page + after.spine * 1000).toBeGreaterThan(start.page + start.spine * 1000);
});

test("a fast flick finishes without crossing the page", async ({ page }, testInfo) => {
  await openSample(page);
  const start = await readerState(page);
  const g = await grab(page);
  const x1 = g.x0 - 36;
  await manualFrames(page);
  await dispatchPointers(page, [
    { type: "pointerdown", x: g.x0, y: g.y },
    { type: "pointermove", x: g.x0 - 14, y: g.y },
    { type: "pointermove", x: x1, y: g.y },
    { type: "pointerup", x: x1, y: g.y },
  ]);
  await stepFrames(page, 14);
  const mid = await metrics(page);
  expect(mid.turning).toBe(true);
  expect(mid.curl).toBe(true);
  expect(mid.page).toBe(start.page);
  expect(await page.evaluate(() => window.__sawTurning)).toBe(true);
  if (testInfo.project.name === "webkit-iphone-390") {
    await page.screenshot({ path: testInfo.outputPath("flick.png") });
    saveShot(testInfo.outputPath("flick.png"), "webkit-iphone-390-flick.png");
  }
  await releaseFrames(page);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const after = await readerState(page);
  expect(after.page + after.spine * 1000).toBeGreaterThan(start.page + start.spine * 1000);
});

test("a short release springs back", async ({ page }) => {
  await openSample(page);
  const start = await readerState(page);
  const g = await grab(page);
  const x1 = g.xAt(0.12);
  await sendPointers(page, [{ type: "pointerdown", x: g.x0, y: g.y }, ...stroke(g.x0, g.y, x1, g.y, 4)]);
  expect((await metrics(page)).turning).toBe(true);
  await page.waitForTimeout(140);
  await sendPointers(page, [
    { type: "pointermove", x: x1 - 1, y: g.y },
    { type: "pointerup", x: x1 - 1, y: g.y },
  ]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const after = await readerState(page);
  expect(after.page).toBe(start.page);
  expect(after.spine).toBe(start.spine);
});

test("a tap plays the full turn", async ({ page }, testInfo) => {
  await openSample(page);
  const start = await readerState(page);
  const box = await page.locator("#reader-book").boundingBox();
  const x = box.x + box.width * 0.82;
  const y = box.y + box.height * 0.5;
  await manualFrames(page);
  await dispatchPointers(page, [
    { type: "pointerdown", x, y },
    { type: "pointerup", x, y },
  ]);
  await stepFrames(page, 14);
  const mid = await metrics(page);
  expect(mid.turning).toBe(true);
  expect(mid.curl).toBe(true);
  expect(await page.evaluate(() => window.__sawTurning)).toBe(true);
  if (testInfo.project.name === "webkit-iphone-390") {
    await page.screenshot({ path: testInfo.outputPath("tap.png") });
    saveShot(testInfo.outputPath("tap.png"), "webkit-iphone-390-tap.png");
  }
  await releaseFrames(page);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  const after = await readerState(page);
  expect(after.page + after.spine * 1000).toBeGreaterThan(start.page + start.spine * 1000);
});

test("desktop spread turns from the center gutter", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "spread is a wide-screen layout");
  await openSample(page);
  const before = await metrics(page);
  expect(before.spread).toBe(true);
  expect(before.hinge).toBe("gutter");
  await page.screenshot({ path: testInfo.outputPath("spread-before.png") });
  saveShot(testInfo.outputPath("spread-before.png"), "chromium-desktop-spread-before.png");
  const g = await grab(page);
  const x1 = g.box.x + g.box.width * 0.36;
  await sendPointers(page, [{ type: "pointerdown", x: g.x0, y: g.y }, ...stroke(g.x0, g.y, x1, g.y, 10)]);
  const mid = await metrics(page);
  expect(mid.turning).toBe(true);
  expect(mid.spread).toBe(true);
  expect(Math.abs(mid.rootX - mid.bookW / 2)).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath("spread.png") });
  saveShot(testInfo.outputPath("spread.png"), "chromium-desktop-spread.png");
  await sendPointers(page, [{ type: "pointerup", x: x1, y: g.y }]);
  await expect.poll(async () => (await readerState(page)).turning).toBe(false);
});

test("快速換頁 is remembered and skips the curl", async ({ page }, testInfo) => {
  await openSample(page);
  const toggle = page.locator("#reader-turn");
  await expect(toggle).toHaveText("快速換頁");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const phone = testInfo.project.name === "webkit-iphone-390";
  if (phone) {
    await page.screenshot({ path: testInfo.outputPath("fast-before.png") });
    saveShot(testInfo.outputPath("fast-before.png"), "webkit-iphone-390-fast-before.png");
  }
  const more = page.locator("#reader-more");
  if (await more.isVisible()) await more.click();
  const start = await readerState(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#reader-book")).toHaveClass(/is-fast/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("libraryread.reader.v1")));
  expect(stored.turn).toBe("fast");

  const box = await page.locator("#reader-book").boundingBox();
  await sendPointers(page, [
    { type: "pointerdown", x: box.x + box.width * 0.82, y: box.y + box.height * 0.5 },
    { type: "pointerup", x: box.x + box.width * 0.82, y: box.y + box.height * 0.5 },
  ]);
  const during = await metrics(page);
  expect(during.curl).toBe(false);
  expect(during.turning).toBe(false);
  expect(during.fast).toBe(true);
  await expect.poll(async () => (await readerState(page)).page + (await readerState(page)).spine * 1000).toBeGreaterThan(
    start.page + start.spine * 1000
  );
  if (phone) {
    await page.screenshot({ path: testInfo.outputPath("fast-after.png") });
    saveShot(testInfo.outputPath("fast-after.png"), "webkit-iphone-390-fast-after.png");
  }

  await page.reload();
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect(page.locator("#reader-turn")).toHaveAttribute("aria-pressed", "true");
  const again = await page.evaluate(() => JSON.parse(localStorage.getItem("libraryread.reader.v1")));
  expect(again.turn).toBe("fast");
  await expect(page.locator("#reader-book")).toHaveClass(/is-fast/);
});
