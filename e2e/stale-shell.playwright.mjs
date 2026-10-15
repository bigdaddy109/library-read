/**
 * Old-cache scenario: a phone that installed the previous shell (old SW,
 * old cache, old shelf snapshot) opens the site after a release.
 * Needs the local server's /__test/shell switch, so it does not run with LIVE_URL.
 */
import {
  FIXTURE_BOOKS,
  LOCAL,
  SITE,
  audioAdvances,
  audioState,
  expect,
  openCover,
  readerState,
  setShell,
  shot,
  signIn,
  startReading,
  tapNext,
  test,
  visibleText,
} from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { fixtureEpubBytes } from "../test/library-fixture.mjs";

const VERSION = Number(readFileSync(new URL("../docs/sw.js", import.meta.url), "utf8").match(/library-read-shell-v(\d+)/)[1]);
const OLD = VERSION - 1;
const CACHED_EPUB_ID = "fx-cached-what-if-1";
/** What an older install left behind: a 2-book shelf, one EPUB already downloaded. */
const STALE_SNAPSHOT = [
  { id: "immune/immune", collectionId: "immune", collectionTitle: "Immune", title: "Immune", author: "Philipp Dettmer", chapters: [{ id: "Immune-Part01.mp3", title: "Part 01" }], ebook: null },
  {
    id: "munroe/what-if-1",
    collectionId: "munroe",
    collectionTitle: "Munroe",
    folder: "what-if-1",
    title: "What If?",
    author: "Randall Munroe",
    chapters: [],
    ebook: { id: "what-if-1.epub", name: "what-if-1.epub", driveId: CACHED_EPUB_ID, size: 1 },
  },
];

async function seedCachedEpub(page) {
  const b64 = Buffer.from(fixtureEpubBytes("munroe/what-if-1")).toString("base64");
  await page.evaluate(
    async ({ key, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open("library-read", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("ebooks");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("ebooks", "readwrite");
          tx.objectStore("ebooks").put({ blob: new Blob([bytes], { type: "application/epub+zip" }), savedAt: Date.now() }, key);
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { key: CACHED_EPUB_ID, b64 }
  );
}

test.use({ serviceWorkers: "allow" });
test.skip(!LOCAL, "the shell switch only exists on the local test server");

async function shellState(page) {
  return page.evaluate(async () => ({
    caches: await caches.keys(),
    controller: navigator.serviceWorker?.controller?.scriptURL || null,
    appScript: document.querySelector('script[type="module"]')?.getAttribute("src") || "",
    header: document.getElementById("app-version")?.textContent || "",
    covers: document.querySelectorAll(".cover-card[data-id]").length,
    origin: performance.timeOrigin,
    playing: (() => {
      const a = document.getElementById("audio");
      return Boolean(a && !a.paused && !a.ended);
    })(),
  }));
}

/** shellState that tolerates the app's own controllerchange reload. */
async function settled(page) {
  for (let i = 0; i < 8; i += 1) {
    try {
      await page.waitForLoadState("load");
      return await shellState(page);
    } catch {
      await page.waitForTimeout(500);
    }
  }
  return shellState(page);
}

async function installOldShell(page, context) {
  await setShell("old");
  await context.addInitScript((rows) => {
    if (localStorage.getItem("__staleSeeded")) return;
    localStorage.setItem("__staleSeeded", "1");
    localStorage.setItem("libraryread.library.v1", JSON.stringify(rows));
  }, STALE_SNAPSHOT);
  await page.goto(SITE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(async () => (await settled(page)).caches).toEqual([`library-read-shell-v${OLD}`]);
  await expect.poll(async () => (await settled(page)).controller).toMatch(/\/sw\.js$/);
}

test("an installed previous shell (old SW + cache + stale shelf + cached EPUB) upgrades and still reads", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  await installOldShell(page, context);
  await seedCachedEpub(page);
  const before = await settled(page);
  expect(before.appScript).toBe(`./app.js?v=${OLD}`);
  expect(before.header).toBe(`v${OLD}`);
  expect(before.covers).toBe(STALE_SNAPSHOT.length);
  await shot(page, testInfo, "stale-1-old-shell-installed");

  await setShell("current");
  await page.reload();
  await expect
    .poll(async () => {
      const s = await settled(page);
      return `${s.caches.join(",")} ${s.appScript} ${s.header}`;
    }, { timeout: 30_000 })
    .toBe(`library-read-shell-v${VERSION} ./app.js?v=${VERSION} v${VERSION}`);
  await page.reload();
  const after = await settled(page);
  expect(after.caches).toEqual([`library-read-shell-v${VERSION}`]);
  expect(after.controller).toMatch(/\/sw\.js$/);
  expect(after.covers).toBe(STALE_SNAPSHOT.length);
  await shot(page, testInfo, "stale-2-upgraded");

  // The EPUB saved by the old install opens with no Google sign-in and no network.
  await openCover(page, "munroe/what-if-1");
  await startReading(page);
  await expect.poll(async () => visibleText(page)).toContain("[Intro]");
  await tapNext(page);
  expect((await readerState(page)).page).toBeGreaterThan(0);
  await shot(page, testInfo, "stale-3-cached-ebook-after-upgrade");
  await page.locator("#reader-back").click();

  // Playwright can only stub requests a service worker makes in Chromium; in
  // WebKit the SW audio proxy (and GIS) would reach the real Google servers.
  if (browserName !== "chromium") return;
  await signIn(page);
  expect((await shellState(page)).covers).toBe(FIXTURE_BOOKS.length);
  await openCover(page, "munroe/what-if-1");
  await startReading(page, { listen: true });
  await audioAdvances(page);
  expect((await audioState(page)).src).toContain("/drive-media/");
  await shot(page, testInfo, "stale-4-listen-via-sw-proxy");
});

test("a page left open on the old shell upgrades when it returns, but not mid-chapter", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "SW-proxied audio is only stubbable in Chromium");
  test.setTimeout(180_000);
  await installOldShell(page, context);
  await signIn(page);
  await openCover(page, "munroe/what-if-1");
  await startReading(page, { listen: true });
  await audioAdvances(page);
  await page.evaluate(() => (document.getElementById("audio").loop = true));
  const listening = await shellState(page);
  expect(listening.header).toBe(`v${OLD}`);

  await setShell("current");
  await page.waitForTimeout(61_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(5_000);
  const mid = await shellState(page);
  expect(mid.origin, "no reload while a chapter plays").toBe(listening.origin);
  expect(mid.playing).toBe(true);
  expect(mid.header).toBe(`v${OLD}`);

  const pos = await readerState(page);
  await page.evaluate(() => document.getElementById("audio").pause());
  await expect
    .poll(async () => {
      const s = await settled(page);
      return `${s.header} ${s.caches.join(",")}`;
    }, { timeout: 30_000 })
    .toBe(`v${VERSION} library-read-shell-v${VERSION}`);
  expect((await shellState(page)).origin).not.toBe(listening.origin);
  await openCover(page, "munroe/what-if-1");
  await startReading(page);
  const back = await readerState(page);
  expect(back.spine).toBe(pos.spine);
});

test("reloading while a new service worker takes over does not loop", async ({ page }) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  await setShell("old");
  await page.goto(SITE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await setShell("current");
  await page.reload();
  await page.waitForTimeout(8_000);
  expect(navigations, "goto + reload + at most one SW reload").toBeLessThanOrEqual(3);
  const s = await settled(page);
  expect(s.controller).toMatch(/\/sw\.js$/);
  expect(s.caches).toEqual([`library-read-shell-v${VERSION}`]);
});
