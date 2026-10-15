import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { FAKE_GIS_SCRIPT, SILENT_MP3, buildDriveTree, handleDriveRequest } from "../test/fake-drive.mjs";
import { FIXTURE_BOOKS } from "../test/library-fixture.mjs";

export { expect, FIXTURE_BOOKS };

/** LIVE_URL=https://bigdaddy109.github.io/library-read/ runs the same suite against Pages. */
export const SITE = process.env.LIVE_URL || "http://127.0.0.1:8080/library-read/";
export const LOCAL = !process.env.LIVE_URL;
export const SHOTS = process.env.SHOTS_DIR || "test-results/shots";

export async function setShell(mode) {
  const res = await fetch(`http://127.0.0.1:8080/__test/shell/${mode}`);
  if (!res.ok) throw new Error(`shell switch ${mode} failed: ${res.status}`);
}

/**
 * Persistent profile per test: WebKit's ephemeral contexts refuse Blobs in
 * IndexedDB (the EPUB cache), and the stale-shell pass needs a real SW install.
 */
export const test = base.extend({
  context: async (
    { playwright, browserName, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, serviceWorkers },
    use
  ) => {
    if (LOCAL) await setShell("current");
    const dir = mkdtempSync(join(tmpdir(), "lr-e2e-"));
    const context = await playwright[browserName].launchPersistentContext(dir, {
      viewport,
      userAgent,
      isMobile,
      hasTouch,
      deviceScaleFactor,
      serviceWorkers,
    });
    await installFakeGoogle(context);
    await use(context);
    await context.close();
    if (LOCAL) await setShell("current");
    rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] || (await context.newPage());
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await use(page);
  },
});

/** Fake GIS + Drive v3 for the fixture Library; also serves ./drive-media/ when no SW proxies it. */
export async function installFakeGoogle(context) {
  const tree = buildDriveTree();
  context.__driveLog = [];
  await context.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_GIS_SCRIPT })
  );
  await context.route("https://www.googleapis.com/drive/v3/**", async (route) => {
    const req = route.request();
    const headers = await req.allHeaders();
    // Playwright's fulfilled 206 for a service-worker request breaks Chromium media
    // (a real network 206 through the same proxy plays), so SW requests get a 200.
    const range = req.serviceWorker() ? "" : headers.range;
    const res = handleDriveRequest(req.url(), { authorization: headers.authorization, range }, tree, context.__driveLog);
    await route.fulfill({
      status: res.status,
      contentType: res.contentType,
      body: res.body,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        ...res.headers,
      },
    });
  });
  await context.route("**/drive-media/**", async (route) => {
    const range = (await route.request().allHeaders()).range || "";
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), SILENT_MP3.length - 1) : SILENT_MP3.length - 1;
      await route.fulfill({
        status: 206,
        contentType: "audio/mpeg",
        body: SILENT_MP3.subarray(start, end + 1),
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${SILENT_MP3.length}` },
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3, headers: { "Accept-Ranges": "bytes" } });
  });
}

export async function shot(page, testInfo, name) {
  const dir = join(SHOTS, LOCAL ? "local" : "live");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${testInfo.project.name}--${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
  return path;
}

export async function signIn(page) {
  await page.locator("#btn-google").click();
  await expect(page.locator(".cover-card[data-id]")).toHaveCount(FIXTURE_BOOKS.length);
  await expect(page.locator("#drive-status")).toContainText("已連上 Google Drive");
}

export async function openCover(page, bookId) {
  const card = page.locator(`.cover-card[data-id="${bookId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.locator("#book-layer .draw-root.is-cover.is-opened")).toBeAttached();
  await expect(page.locator("#book-layer:not([data-morph])")).toBeAttached();
}

export async function startReading(page, { listen = false } = {}) {
  await page.locator(`#book-layer [data-open="${listen ? "listen" : "read"}"]`).click();
  await expect(page.locator("#reader:not([hidden])")).toBeVisible();
  await expect(page.locator("#reader-book[data-pages]")).toBeAttached();
  await expect(page.locator("#book-layer")).toBeHidden();
}

export async function readerState(page) {
  return page.evaluate(() => {
    const book = document.getElementById("reader-book");
    const flow = book.querySelector(".page-viewport .page-flow");
    return {
      spine: Number(book.dataset.spine),
      page: Number(book.dataset.page),
      pages: Number(book.dataset.pages),
      text: flow?.innerText || "",
      color: flow ? getComputedStyle(flow).color : "",
      scriptRan: Boolean(window.__epubScriptRan || window.__epubOnload),
      turning: book.classList.contains("is-turning"),
    };
  });
}

/** Text that is actually inside the visible page box (not the whole chapter). */
export async function visibleText(page) {
  return page.evaluate(() => {
    const vp = document.querySelector("#reader-book .page-viewport");
    const box = vp.getBoundingClientRect();
    const out = [];
    const walker = document.createTreeWalker(vp, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.right > box.left + 1 && r.left < box.right - 1) {
          out.push(node.nodeValue);
          break;
        }
      }
    }
    return out.join(" ");
  });
}

export async function tapNext(page) {
  const before = await readerState(page);
  const box = await page.locator("#reader-book").boundingBox();
  await page.mouse.click(box.x + box.width * 0.88, box.y + box.height * 0.5);
  await expect.poll(async () => {
    const s = await readerState(page);
    return !s.turning && (s.page !== before.page || s.spine !== before.spine);
  }).toBe(true);
}

export async function tapPrev(page) {
  const before = await readerState(page);
  const box = await page.locator("#reader-book").boundingBox();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await expect.poll(async () => {
    const s = await readerState(page);
    return !s.turning && (s.page !== before.page || s.spine !== before.spine);
  }).toBe(true);
}

/** Drag the page and hold mid-turn; returns a release() that commits the turn. */
export async function dragAndHold(page, fraction = 0.3) {
  const box = await page.locator("#reader-book").boundingBox();
  const y = box.y + box.height * 0.55;
  const x0 = box.x + box.width * 0.92;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x0 - box.width * fraction * (i / steps), y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  return async () => {
    await page.mouse.up();
    await expect.poll(async () => (await readerState(page)).turning).toBe(false);
  };
}

export async function audioState(page) {
  return page.evaluate(() => {
    const a = document.getElementById("audio");
    return {
      src: a.currentSrc || a.src || "",
      time: Number(a.currentTime) || 0,
      duration: Number(a.duration) || 0,
      paused: a.paused,
      error: a.error ? a.error.code : 0,
      track: document.getElementById("listen-track")?.textContent || "",
    };
  });
}

export async function audioAdvances(page) {
  await expect.poll(async () => (await audioState(page)).time, { timeout: 20_000 }).toBeGreaterThan(0);
}
