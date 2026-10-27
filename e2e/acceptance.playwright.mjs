import { parseEpub } from "../docs/epub.js?v=1";
import { textChapters, textIndexForAudio } from "../docs/listen.js?v=1";
import { titleFromFilename } from "../docs/library.js?v=1";
import { SERIES_PICKS, fixtureEpubBytes } from "../test/library-fixture.mjs";
import {
  FIXTURE_BOOKS,
  SITE,
  audioAdvances,
  audioState,
  dragAndHold,
  expect,
  openCover,
  readerState,
  shot,
  signIn,
  startReading,
  tapNext,
  tapPrev,
  test,
  visibleText,
} from "./fixtures.mjs";

async function expectedSpineForTrack(bookId, trackIndex) {
  const spec = FIXTURE_BOOKS.find((b) => b.id === bookId);
  const epub = await parseEpub(fixtureEpubBytes(bookId));
  const chapters = textChapters(epub.spine);
  const tracks = spec.audio.map((name) => ({ id: name, title: titleFromFilename(name) }));
  return chapters[textIndexForAudio(chapters, tracks, trackIndex)].spineIndex;
}

test("signed out: the demo book opens from the cover wall and turns pages", async ({ page }, testInfo) => {
  await page.goto(SITE);
  await expect(page.locator(".cover-card[data-id]")).toHaveCount(1);
  await shot(page, testInfo, "00-demo-shelf");
  await openCover(page, "demo/flip");
  await startReading(page);
  await expect.poll(async () => (await readerState(page)).text).toContain("點畫面右邊翻到下一頁");
  await tapNext(page);
  expect((await readerState(page)).page).toBeGreaterThan(0);
});

for (const bookId of SERIES_PICKS) {
  const spec = FIXTURE_BOOKS.find((b) => b.id === bookId);
  const hasAudio = spec.audio.length > 0;
  const slug = bookId.split("/")[0];

  test(`${spec.series}: open ebook, turn pages${hasAudio ? ", listen-along" : ""}`, async ({ page }, testInfo) => {
    await page.goto(SITE);
    await signIn(page);
    if (bookId === SERIES_PICKS[0]) await shot(page, testInfo, "01-shelf-signed-in");

    await openCover(page, bookId);
    await shot(page, testInfo, `${slug}-1-cover-opened`);
    const listenBtn = page.locator('#book-layer [data-open="listen"]');
    if (hasAudio) await expect(listenBtn).toBeEnabled();
    else await expect(listenBtn).toBeDisabled();

    await startReading(page, { listen: hasAudio });
    const first = spec.epub.chapters[0];
    await expect.poll(async () => visibleText(page)).toContain(first.marker);
    const s0 = await readerState(page);
    expect(s0.scriptRan, "EPUB scripts must not run").toBe(false);
    expect(s0.color, "EPUB CSS must not apply").not.toBe("rgb(255, 0, 0)");
    expect(s0.pages).toBeGreaterThan(1);
    await shot(page, testInfo, `${slug}-2-reader`);

    const v1 = await visibleText(page);
    await tapNext(page);
    const v2 = await visibleText(page);
    expect(v2).not.toBe(v1);
    const release = await dragAndHold(page);
    await expect(page.locator("#reader-book.is-turning .face.is-on").first()).toBeVisible();
    await shot(page, testInfo, `${slug}-3-page-flip`);
    await release();
    await tapNext(page);
    const afterDrag = await readerState(page);
    expect(afterDrag.page + afterDrag.spine * 1000).toBeGreaterThan(s0.page + s0.spine * 1000);
    await tapPrev(page);

    if (!hasAudio) return;
    await audioAdvances(page);
    const a0 = await audioState(page);
    expect(a0.src).toContain("/drive-media/");
    expect(a0.track).toContain(`音訊 1/${spec.audio.length}`);
    await shot(page, testInfo, `${slug}-4-listen-along`);

    if (spec.audio.length > 1) {
      const want = await expectedSpineForTrack(bookId, 1);
      await page.evaluate(() => {
        const a = document.getElementById("audio");
        a.currentTime = Math.max(0, a.duration - 0.3);
      });
      await expect(page.locator("#listen-track")).toContainText(`音訊 2/${spec.audio.length}`, { timeout: 20_000 });
      await expect.poll(async () => (await readerState(page)).spine).toBe(want);
      const marker = spec.epub.chapters.find((c, i) => i + 1 === want)?.marker;
      if (marker) await expect.poll(async () => visibleText(page)).toContain(marker);
      await audioAdvances(page);
      await page.waitForTimeout(400);
      await shot(page, testInfo, `${slug}-5-listen-next-chapter`);
    }
  });
}

test("progress, 目錄, 字級 and the alignment sheet", async ({ page }, testInfo) => {
  const bookId = "immune/immune";
  await page.goto(SITE);
  await signIn(page);
  await openCover(page, bookId);
  await startReading(page, { listen: true });
  await audioAdvances(page);

  await page.locator("#reader-toc").click();
  await expect(page.locator("#toc-list li")).toHaveCount(6);
  await shot(page, testInfo, "immune-6-toc");
  await page.locator("#toc-list li").nth(4).locator("button").click();
  await expect.poll(async () => visibleText(page)).toContain("[Memory]");

  await page.locator("#listen-tracks").click();
  await expect(page.locator("#align-hint")).toContainText("依比例對齊");
  await expect(page.locator("#tracks-list li")).toHaveCount(3);
  await page.locator("#btn-align").click();
  await page.locator("#listen-tracks").click();
  await expect(page.locator("#align-hint")).toContainText("已手動調整 +4 章");
  await shot(page, testInfo, "immune-7-align-sheet");
  await page.locator('[data-close="tracks-sheet"]').click();

  const fontSize = () => page.locator("#reader-book .page-viewport .page-flow").evaluate((el) => getComputedStyle(el).fontSize);
  const before = await fontSize();
  const more = page.locator("#reader-more");
  if (await more.isVisible()) await more.click();
  await page.locator("#reader-font").click();
  await expect.poll(fontSize).not.toBe(before);

  await tapNext(page);
  const saved = await readerState(page);
  await page.locator("#reader-back").click();
  await expect(page.locator("#reader")).toBeHidden();
  expect((await audioState(page)).paused).toBe(true);
  await page.reload();
  await expect(page.locator(".cover-card[data-id]")).toHaveCount(FIXTURE_BOOKS.length);
  await openCover(page, bookId);
  await expect(page.locator("#book-layer .progress")).toContainText("讀到：The Memory");
  await startReading(page);
  const restored = await readerState(page);
  expect(restored.spine).toBe(saved.spine);
  expect(Math.abs(restored.page - saved.page)).toBeLessThanOrEqual(1);
});

test("a cached EPUB reopens without downloading it again", async ({ page, context }) => {
  await page.goto(SITE);
  await signIn(page);
  await openCover(page, "munroe/what-if-1");
  await startReading(page);
  await page.locator("#reader-back").click();
  const downloads = () => context.__driveLog.filter((l) => l.includes("alt=media")).length;
  const n = downloads();
  await openCover(page, "munroe/what-if-1");
  await startReading(page);
  await expect.poll(async () => visibleText(page)).toContain("[Intro]");
  expect(downloads()).toBe(n);
});
