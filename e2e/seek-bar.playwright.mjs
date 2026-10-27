import { audioAdvances, expect, openCover, saveOptShot, signIn, startReading, test } from "./fixtures.mjs";

const SITE = process.env.LIVE_URL || "http://127.0.0.1:8080/library-read/";

test("the progress bar seeks on release and updates the lock screen", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__ms = { positions: [], handlers: {} };
    const ms = navigator.mediaSession;
    if (!ms) {
      window.__ms.failed = true;
      return;
    }
    const origHandler = ms.setActionHandler?.bind(ms);
    const origPos = ms.setPositionState?.bind(ms);
    try {
      ms.setActionHandler = (action, fn) => {
        window.__ms.handlers[action] = fn;
        try {
          origHandler?.(action, fn);
        } catch {
          /* this browser has no seekto */
        }
      };
      ms.setPositionState = (state) => {
        window.__ms.positions.push({
          duration: state?.duration,
          position: state?.position,
          playbackRate: state?.playbackRate,
        });
        try {
          origPos?.(state);
        } catch {
          /* position still settling */
        }
      };
    } catch {
      window.__ms.failed = true;
    }
  });

  await page.goto(SITE);
  await signIn(page);
  await openCover(page, "munroe/what-if-1");
  await startReading(page, { listen: true });
  await audioAdvances(page);
  await page.evaluate(() => {
    const audio = document.getElementById("audio");
    audio.pause();
    audio.currentTime = 1;
  });
  await expect(page.locator("#listen-time")).toContainText("0:01");

  const bar = page.locator("#listen-scrub");
  const box = await bar.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  await page.evaluate(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    window.__seekSets = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(value) {
        window.__seekSets += 1;
        desc.set.call(this, value);
      },
    });
  });

  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 12, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, y, { steps: 8 });
  expect(await page.evaluate(() => window.__seekSets)).toBe(0);
  await expect(page.locator("#listen-time")).toContainText("0:01");
  if (testInfo.project.name === "webkit-iphone-390") await saveOptShot(page, testInfo, "seek-bar");
  await page.mouse.up();
  expect(await page.evaluate(() => window.__seekSets)).toBe(1);
  await expect.poll(() => page.locator("#audio").evaluate((a) => a.currentTime)).toBeGreaterThan(8);

  const session = await page.evaluate(() => ({
    failed: window.__ms.failed || false,
    actions: Object.keys(window.__ms.handlers),
    positions: window.__ms.positions.length,
  }));
  expect(session.failed).not.toBe(true);
  expect(session.actions).toContain("seekto");
  const before = session.positions;
  await page.evaluate(() => window.__ms.handlers.seekto({ seekTime: 5 }));
  await expect.poll(() => page.locator("#audio").evaluate((a) => a.currentTime)).toBeGreaterThan(4);
  await expect.poll(() => page.evaluate(() => window.__ms.positions.length)).toBeGreaterThan(before);
  const last = await page.evaluate(() => window.__ms.positions.at(-1));
  expect(last.position).toBeGreaterThan(4);
  expect(last.duration).toBeGreaterThan(10);
});
