import { expect, openCover, saveOptShot, startReading, test } from "./fixtures.mjs";

const SITE = process.env.LIVE_URL || "http://127.0.0.1:8080/library-read/";

function contrast(fg, bg) {
  const lum = (css) => {
    const parts = css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lin = parts.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const a = lum(fg);
  const b = lum(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

async function pageColors(page) {
  return page.evaluate(() => {
    const flow = document.querySelector("#reader-book .page-viewport .page-flow");
    const quote = flow?.querySelector("blockquote");
    const paper = document.querySelector("#reader-book .page-paper");
    return {
      flow: flow ? getComputedStyle(flow).color : "",
      quote: quote ? getComputedStyle(quote).color : "",
      paper: paper ? getComputedStyle(paper).backgroundColor : "",
    };
  });
}

async function settled(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById("reader");
    if (!el || el.hidden) return false;
    return getComputedStyle(el).opacity === "1" && el.getAnimations().every((a) => a.playState === "finished");
  });
}

async function cycleTheme(page) {
  const theme = page.locator("#reader-theme");
  const more = page.locator("#reader-more");
  if (!(await theme.isVisible()) && (await more.count()) && (await more.isVisible())) await more.click();
  await theme.click();
  if ((await more.count()) && (await more.isVisible()) && (await more.getAttribute("aria-expanded")) === "true") {
    await more.click();
  }
}

test("night and dim-sepia keep body text and blockquotes readable", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(SITE);
  await openCover(page, "demo/flip");
  await startReading(page);
  await page.evaluate(() => {
    const flow = document.querySelector("#reader-book .page-viewport .page-flow");
    const quote = document.createElement("blockquote");
    quote.textContent = "引用的句子在夜間也要讀得清楚。";
    flow.prepend(quote);
  });
  await settled(page);

  const light = await pageColors(page);
  expect(contrast(light.flow, light.paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(light.quote, light.paper)).toBeGreaterThanOrEqual(4.5);

  await cycleTheme(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settled(page);
  const dark = await pageColors(page);
  expect(contrast(dark.flow, dark.paper), `body ${dark.flow} on ${dark.paper}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(dark.quote, dark.paper), `quote ${dark.quote} on ${dark.paper}`).toBeGreaterThanOrEqual(4.5);
  expect(dark.flow).not.toBe("rgb(36, 28, 20)");
  expect(dark.quote).not.toBe("rgb(74, 63, 51)");
  if (testInfo.project.name === "webkit-iphone-390") await saveOptShot(page, testInfo, "night-dark");

  await cycleTheme(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await settled(page);
  const sepia = await pageColors(page);
  expect(contrast(sepia.flow, sepia.paper), `body ${sepia.flow} on ${sepia.paper}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(sepia.quote, sepia.paper), `quote ${sepia.quote} on ${sepia.paper}`).toBeGreaterThanOrEqual(4.5);
  expect(sepia.flow).not.toBe("rgb(36, 28, 20)");
  expect(sepia.quote).not.toBe("rgb(74, 63, 51)");
  if (testInfo.project.name === "webkit-iphone-390") await saveOptShot(page, testInfo, "night-sepia");
});
