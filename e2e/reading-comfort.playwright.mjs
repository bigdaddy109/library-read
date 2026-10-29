import { copyFileSync, mkdirSync } from "node:fs";
import { SITE, expect, openCover, signIn, startReading, test } from "./fixtures.mjs";

const MEDIA = process.env.READING_MEDIA ?? "/cursor/stores/self/media/reading-v9";

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

async function keepShot(page, testInfo, name, opts = {}) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, ...opts });
  if (testInfo.project.name === "webkit-iphone-390") saveShot(path, `${name}.png`);
}

test("a return visit signs in without a consent prompt", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("libraryread.drive.seen", "1");
  });
  await page.goto(SITE);
  await expect(page.locator("#btn-google")).toBeEnabled();
  await page.locator("#btn-google").click();
  await expect(page.locator(".cover-card[data-id='munroe/what-if-1']")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__gisPrompts || [])).toEqual([""]);
  await keepShot(page, testInfo, "sign-in-silent");
});

test("the first visit still asks for consent", async ({ page }) => {
  await page.goto(SITE);
  await page.locator("#btn-google").click();
  await expect(page.locator(".cover-card[data-id]").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__gisPrompts || [])).toEqual(["consent"]);
});

test("a Listen jump on a known device tries the silent prompt", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("libraryread.drive.seen", "1");
  });
  await page.goto(`${SITE}?series=Immune&book=Immune&ch=2`);
  await expect(page.locator("#btn-open-link")).toBeEnabled();
  expect(await page.evaluate(() => window.__gisRequests || 0)).toBe(0);
  await page.locator("#btn-open-link").click();
  await expect(page.locator("#reader:not([hidden])")).toBeVisible();
  const prompts = await page.evaluate(() => window.__gisPrompts || []);
  expect(prompts[0]).toBe("");
  expect(prompts).not.toContain("consent");
});

test("listen-along has playback speed and a sleep timer", async ({ page }, testInfo) => {
  await page.goto(SITE);
  await signIn(page);
  await openCover(page, "munroe/what-if-1");
  await startReading(page, { listen: true });
  const rate = page.locator("#listen-rate");
  const sleep = page.locator("#listen-sleep");
  await expect(rate).toHaveText("1.0×");
  await expect(sleep).toHaveText("睡眠");
  await rate.click();
  await expect(rate).toHaveText("1.25×");
  await expect.poll(() => page.locator("#audio").evaluate((el) => el.playbackRate)).toBe(1.25);
  await sleep.click();
  await expect(sleep).toHaveText("15 分");
  await expect(page.locator("#toast")).toContainText("15 分鐘後暫停");
  await keepShot(page, testInfo, "player-speed-sleep");
  await rate.click();
  await expect(rate).toHaveText("1.5×");
  await sleep.click();
  await expect(sleep).toHaveText("30 分");
});

test("the shelf shows 繼續閱讀 and a cover percentage", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "libraryread.progress.v1",
      JSON.stringify({
        "munroe/what-if-1": {
          text: {
            kind: "epub-cfi",
            locator: "epubcfi(/6/4)",
            fraction: 0.42,
            label: "Global Windstorm",
            updatedAt: "2026-10-17T01:00:00.000Z",
          },
          updatedAt: "2026-10-17T01:00:00.000Z",
          lastKind: "text",
        },
      })
    );
  });
  await page.goto(SITE);
  await signIn(page);
  const row = page.locator(".continue-row");
  await expect(row).toContainText("繼續閱讀");
  await expect(row).toContainText("42%");
  await expect(page.locator(".cover-card[data-id='munroe/what-if-1'] .cover-progress")).toHaveText("42%");
  await page.locator(".cover-card[data-id='munroe/what-if-1']").scrollIntoViewIfNeeded();
  await keepShot(page, testInfo, "continue-percent", { fullPage: true });
  await row.click();
  await expect(page.locator("#reader:not([hidden])")).toBeVisible();
  await expect(page.locator("#reader-title")).toHaveText("What If?");
});

test("a book ignores Library Listen progress and does not link there", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "librarylisten.progress",
      JSON.stringify({
        "munroe/what-if-1": { chapterId: "02 - Global Windstorm.mp3", updatedAt: "2026-10-17T01:00:00.000Z" },
      })
    );
    localStorage.setItem(
      "librarylisten.progress.v1",
      JSON.stringify({
        "munroe/what-if-1": { chapterId: "01 - Introduction.mp3", updatedAt: "2026-10-17T02:00:00.000Z" },
      })
    );
    localStorage.setItem(
      "librarylisten.library.v1",
      JSON.stringify([{ id: "listen-only/shelf", title: "Listen shelf only" }])
    );
  });
  await page.goto(SITE);
  await expect(page.locator('a[href*="library-listen"]')).toHaveCount(0);
  await expect(page.locator(".mast")).not.toContainText("Library Listen");
  await signIn(page);
  await openCover(page, "munroe/what-if-1");
  await expect(page.locator("#book-layer a[href*='library-listen']")).toHaveCount(0);
  await expect(page.locator("#book-layer .listen-jump")).toHaveCount(0);
  await expect(page.locator("#book-layer .listen-heard")).toHaveCount(0);
  await expect(page.locator("#book-layer")).not.toContainText("到 Library Listen");
  await expect(page.locator("#book-layer")).not.toContainText("Listen 聽到");
  await expect(page.locator("#book-layer")).not.toContainText("Listen shelf only");
  await expect(page.locator("#book-layer .progress")).toContainText("尚未開始");
  const ownSnapshot = await page.evaluate(() => localStorage.getItem("libraryread.library.v1"));
  expect(ownSnapshot).toContain("munroe/what-if-1");
  expect(ownSnapshot).not.toContain("listen-only/shelf");
  await keepShot(page, testInfo, "book-no-listen-link");
});

test("night mode follows the system, then dark and dim-sepia persist", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(SITE);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#btn-theme")).toHaveText("跟隨系統");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-choice", "dark");
  await expect(page.locator("#btn-theme")).toHaveText("深色");
  await page.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await expect(page.locator("#btn-theme")).toHaveText("暗褐");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect(page.locator("#reader-theme")).toHaveText("暗褐");
  const pageColor = await page.locator("#reader-book .page-paper").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(pageColor).not.toBe("rgb(251, 246, 236)");
  await page.waitForFunction(() => {
    const el = document.getElementById("reader");
    if (!el || el.hidden) return false;
    return getComputedStyle(el).opacity === "1" && el.getAnimations().every((a) => a.playState === "finished");
  });
  await keepShot(page, testInfo, "night-mode");
});

test("series chips and the sign-in button are at least 44px", async ({ page }) => {
  await page.goto(SITE);
  const google = await page.locator("#btn-google").boundingBox();
  const chip = await page.locator("#series-chips .chip").first().boundingBox();
  expect(google.height).toBeGreaterThanOrEqual(44);
  expect(chip.height).toBeGreaterThanOrEqual(44);
});
