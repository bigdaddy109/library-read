import { expect, shot, tapNext, test, visibleText, SITE, readerState } from "./fixtures.mjs";

test("deep link does not sign in until the button tap, then opens that chapter", async ({ page }, testInfo) => {
  const series = encodeURIComponent("Immune");
  const book = encodeURIComponent("Immune");
  await page.goto(`${SITE}?series=${series}&book=${book}&ch=2`);
  const open = page.locator("#btn-open-link");
  await expect(open).toBeVisible();
  await expect(open).toHaveText("用 Google 登入並打開");
  await expect(page.locator("#link-banner-text")).toContainText("Immune");
  await expect(page.locator("#reader")).toBeHidden();
  await expect(open).toBeEnabled();
  expect(await page.evaluate(() => window.__gisRequests || 0)).toBe(0);
  await shot(page, testInfo, "deeplink-1-waiting");

  await open.click();
  await expect(page.locator("#reader:not([hidden])")).toBeVisible();
  await expect.poll(async () => visibleText(page)).toContain("[Soldiers]");
  const state = await readerState(page);
  expect(state.spine).toBe(2);
  const gisAfterOpen = await page.evaluate(() => ({ n: window.__gisRequests, prompts: window.__gisPrompts }));
  expect(gisAfterOpen.prompts.every((prompt) => prompt === "consent" || prompt === "")).toBe(true);
  expect(gisAfterOpen.prompts.filter((prompt) => prompt !== "" && prompt !== "consent")).toEqual([]);
  await shot(page, testInfo, "deeplink-2-chapter");

  await tapNext(page);
  const gisAfterTurn = await page.evaluate(() => window.__gisRequests);
  expect(gisAfterTurn).toBe(gisAfterOpen.n);
  await shot(page, testInfo, "deeplink-3-page-turn");
});

test("a deep link to a missing book returns to the shelf", async ({ page }, testInfo) => {
  await page.goto(`${SITE}?series=${encodeURIComponent("沒有這系列")}&book=${encodeURIComponent("沒有這本")}`);
  await expect(page.locator("#btn-open-link")).toBeEnabled();
  expect(await page.evaluate(() => window.__gisRequests || 0)).toBe(0);
  await page.locator("#btn-open-link").click();
  await expect(page.locator("#drive-status")).toContainText("找不到這本書，已回到書架。");
  await expect(page.locator("#reader")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#link-banner")).toBeHidden();
  await shot(page, testInfo, "deeplink-missing");
});
