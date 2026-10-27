import {
  audioAdvances,
  expect,
  openCover,
  readerState,
  saveOptShot,
  signIn,
  startReading,
  tapNext,
  test,
  visibleText,
} from "./fixtures.mjs";

const SITE = process.env.LIVE_URL || "http://127.0.0.1:8080/library-read/";

async function seekFraction(page, fraction) {
  await expect.poll(() => page.locator("#audio").evaluate((a) => Number.isFinite(a.duration) && a.duration > 1)).toBe(true);
  await page.evaluate(async (f) => {
    const audio = document.getElementById("audio");
    audio.pause();
    const target = Math.min(audio.duration * f, Math.max(0, audio.duration - 0.5));
    if (Math.abs(audio.currentTime - target) > 0.05) {
      await new Promise((resolve) => {
        const done = () => {
          audio.removeEventListener("seeked", done);
          resolve();
        };
        audio.addEventListener("seeked", done);
        setTimeout(done, 1500);
        audio.currentTime = target;
      });
    }
    audio.dispatchEvent(new Event("timeupdate"));
  }, fraction);
}

test("one audio file follows the book, and a hand turn pauses it", async ({ page }, testInfo) => {
  await page.goto(SITE);
  await signIn(page);
  await openCover(page, "immune/immune");
  await startReading(page, { listen: true });
  await audioAdvances(page);
  await expect.poll(async () => visibleText(page)).toContain("[Battlefield]");

  const opened = await readerState(page);
  await seekFraction(page, 0.02);
  await page.waitForTimeout(250);
  const early = await readerState(page);
  expect(early.spine).toBe(opened.spine);
  expect(early.page).toBe(opened.page);

  await seekFraction(page, 0.68);
  await expect(page.locator("#reader-where")).toHaveText("The Messengers");
  await expect.poll(async () => visibleText(page)).toContain("[Messengers]");
  if (testInfo.project.name === "webkit-iphone-390") await saveOptShot(page, testInfo, "follow-page");

  await page.locator("#reader-back").click();
  await openCover(page, "school/middle-school-01-first-day");
  await startReading(page, { listen: true });
  await audioAdvances(page);
  await seekFraction(page, 0.04);
  await page.waitForTimeout(200);
  await tapNext(page);
  const handed = await readerState(page);
  await seekFraction(page, 0.72);
  await page.waitForTimeout(400);
  const held = await readerState(page);
  expect(held.spine).toBe(handed.spine);
  expect(held.page).toBe(handed.page);

  const follow = page.locator("#listen-follow");
  await follow.click();
  await expect(follow).not.toBeChecked();
  await follow.click();
  await expect(follow).toBeChecked();
  await expect.poll(async () => {
    const state = await readerState(page);
    return state.spine * 1000 + state.page;
  }).toBeGreaterThan(handed.spine * 1000 + handed.page);
});
