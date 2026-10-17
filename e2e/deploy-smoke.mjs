import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const LIVE = "https://bigdaddy109.github.io/library-read/";
const sw = readFileSync(new URL("../docs/sw.js", import.meta.url), "utf8");
const version = sw.match(/const CACHE = "library-read-shell-v(\d+)";/)?.[1];
if (!version) throw new Error("docs/sw.js has no shell version");

const shots = new URL("../deploy-smoke-screenshots/", import.meta.url);
mkdirSync(shots, { recursive: true });

test("live homepage version matches, and 翻頁試讀 opens without Google sign-in", async ({ page }) => {
  const oauth = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("oauth2") || url.includes("/o/oauth2")) oauth.push(url);
  });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode */
    }
  });

  await page.goto(`${LIVE}?cb=${Date.now()}`);
  await expect(page.locator("#app-version")).toHaveText(`v${version}`);
  await expect(page.locator("#btn-google")).toHaveText("用 Google 登入");
  const card = page.locator('.cover-card[data-id="demo/flip"]');
  await expect(card.locator("h3")).toHaveText("翻頁試讀");
  await page.screenshot({ path: new URL("01-homepage.png", shots).pathname, fullPage: true });

  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#book-layer .draw-root.is-cover.is-opened")).toBeAttached();
  await expect(page.locator("#book-layer:not([data-morph])")).toBeAttached();
  await expect(page.locator("#book-layer h2")).toHaveText("翻頁試讀");
  await page.screenshot({ path: new URL("02-sample-cover.png", shots).pathname });

  await page.locator('#book-layer [data-open="read"]').click();
  await expect(page.locator("#reader:not([hidden])")).toBeVisible();
  await expect(page.locator("#reader-title")).toHaveText("翻頁試讀");
  await expect(page.locator("#reader-book[data-pages]")).toBeAttached();
  await expect(page.locator("#reader-book")).toContainText("點畫面右邊翻到下一頁");
  await expect(page).toHaveURL(/bigdaddy109\.github\.io\/library-read/);
  await expect(page.locator("#drive-status")).not.toContainText("已連上 Google Drive");
  expect(oauth, "smoke test must not start Google sign-in").toEqual([]);
  await page.screenshot({ path: new URL("03-sample-reader.png", shots).pathname });
});
