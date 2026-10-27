import { expect, openCover, saveOptShot, startReading, test } from "./fixtures.mjs";

const SITE = process.env.LIVE_URL || "http://127.0.0.1:8080/library-read/";

async function boxAtLeast44(locator) {
  const box = await locator.boundingBox();
  expect(box, await locator.evaluate((el) => el.id)).toBeTruthy();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test("the phone reader bar keeps back, title, and 目錄", async ({ page }, testInfo) => {
  await page.goto(SITE);
  await openCover(page, "demo/flip");
  await startReading(page);
  const phone = testInfo.project.name === "webkit-iphone-390";
  const more = page.locator("#reader-more");
  await expect(page.locator("#reader-back")).toBeVisible();
  await expect(page.locator("#reader-title")).toBeVisible();
  await expect(page.locator("#reader-toc")).toBeVisible();

  if (phone) {
    await expect(more).toBeVisible();
    await expect(more).toHaveText("更多");
    for (const id of ["#reader-font", "#reader-theme", "#reader-turn", "#reader-reauth"]) {
      await expect(page.locator(id)).toBeHidden();
    }
    for (const id of ["#reader-back", "#reader-toc", "#reader-more"]) await boxAtLeast44(page.locator(id));
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
  } else {
    await expect(more).toBeHidden();
    await expect(page.locator("#reader-font")).toBeVisible();
  }

  await page.evaluate(() => {
    const button = document.getElementById("reader-reauth");
    button.hidden = false;
    button.classList.remove("hidden");
  });
  for (const id of ["#reader-font", "#reader-theme", "#reader-turn", "#reader-reauth"]) {
    await expect(page.locator(id)).toBeVisible();
    await boxAtLeast44(page.locator(id));
  }
  if (phone) await saveOptShot(page, testInfo, "reader-bar");

  const fontSize = () => page.locator("#reader-book .page-viewport .page-flow").evaluate((el) => getComputedStyle(el).fontSize);
  const before = await fontSize();
  await page.locator("#reader-font").click();
  await expect.poll(fontSize).not.toBe(before);

  await page.locator("#reader-reauth").click();
  await expect.poll(() => page.evaluate(() => window.__gisPrompts || [])).toContain("consent");
});
