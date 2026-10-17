import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LISTEN_PROGRESS_KEYS,
  RATE_KEY,
  THEME_KEY,
  listenHeardChapter,
  listenHeardLabel,
  listenOpenUrl,
  loadRate,
  loadThemeChoice,
  nextRate,
  nextSleepMinutes,
  nextTheme,
  progressLineText,
  progressPercent,
  rateLabel,
  readListenRecord,
  resolveTheme,
  saveRate,
  saveThemeChoice,
  sleepButtonText,
  sleepIsDue,
  sleepToast,
} from "../docs/comfort.js?v=1";
import { PROGRESS_KEY, latestTextBook } from "../docs/library.js?v=1";

function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const book = {
  id: "munroe/what-if-1",
  title: "What If?",
  chapters: [
    { id: "01 - Introduction.mp3", title: "Introduction" },
    { id: "02 - Global Windstorm.mp3", title: "Global Windstorm" },
  ],
};

describe("playback speed and sleep timer", () => {
  it("cycles 1 → 1.25 → 1.5 → 1 and persists the rate", () => {
    const store = memoryStore();
    assert.equal(loadRate(store), 1);
    assert.equal(rateLabel(1), "1.0×");
    const second = nextRate(1);
    assert.equal(second, 1.25);
    assert.equal(rateLabel(second), "1.25×");
    saveRate(second, store);
    assert.equal(loadRate(store), 1.25);
    assert.equal(store.getItem(RATE_KEY), "1.25");
    assert.equal(nextRate(1.25), 1.5);
    assert.equal(rateLabel(1.5), "1.5×");
    assert.equal(nextRate(1.5), 1);
  });

  it("cycles the sleep timer 15, 30, 45, 60, then off", () => {
    const stepped = [];
    let mins = 0;
    for (let i = 0; i < 5; i += 1) {
      mins = nextSleepMinutes(mins);
      stepped.push(mins);
    }
    assert.deepEqual(stepped, [15, 30, 45, 60, 0]);
    assert.equal(sleepButtonText(0), "睡眠");
    assert.equal(sleepButtonText(15), "15 分");
    assert.equal(sleepToast(15), "15 分鐘後暫停");
    assert.equal(sleepToast(0), "睡眠計時已關閉");
    assert.equal(sleepIsDue(1_000, 1_000), true);
    assert.equal(sleepIsDue(1_000, 999), false);
    assert.equal(sleepIsDue(null, 1_000), false);
  });
});

describe("shelf progress", () => {
  it("shows a percentage with the chapter name", () => {
    assert.equal(progressPercent({ fraction: 0.42, label: "Introduction" }), 42);
    assert.equal(progressLineText({ fraction: 0.42, label: "Introduction" }, true), "讀到：Introduction · 42%");
    assert.equal(progressLineText(null, true), "尚未開始");
  });

  it("picks the most recently read book for 繼續閱讀", () => {
    const store = memoryStore();
    const older = { id: "immune/immune", title: "Immune" };
    const newer = { id: "munroe/what-if-1", title: "What If?" };
    store.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        [older.id]: { text: { kind: "epub-cfi", locator: "epubcfi(/6/2)", fraction: 0.1, updatedAt: "2026-10-16T00:00:00.000Z" } },
        [newer.id]: { text: { kind: "epub-cfi", locator: "epubcfi(/6/4)", fraction: 0.42, updatedAt: "2026-10-17T00:00:00.000Z" } },
      })
    );
    assert.equal(latestTextBook([older, newer], store).id, newer.id);
  });
});

describe("Library Listen link", () => {
  it("opens the same book id with ?open=", () => {
    const url = new URL(listenOpenUrl(book.id));
    assert.equal(url.origin + url.pathname, "https://bigdaddy109.github.io/library-listen/");
    assert.equal(url.searchParams.get("open"), book.id);
  });

  it("reads librarylisten.progress and the live .v1 key", () => {
    const named = memoryStore();
    named.setItem(LISTEN_PROGRESS_KEYS[0], JSON.stringify({ [book.id]: { chapterId: book.chapters[1].id } }));
    assert.equal(listenHeardChapter(book, readListenRecord(book.id, named)), 2);
    assert.equal(listenHeardLabel(2), "Listen 聽到第 2 章");

    const live = memoryStore();
    live.setItem(
      LISTEN_PROGRESS_KEYS[1],
      JSON.stringify({ [book.id]: { chapterId: book.chapters[0].id, positionSeconds: 12 } })
    );
    assert.equal(listenHeardChapter(book, readListenRecord(book.id, live)), 1);
    assert.equal(readListenRecord("missing/book", live), null);
  });
});

describe("night reading", () => {
  it("follows the system, then dark and dim-sepia, and persists the choice", () => {
    assert.equal(resolveTheme("system", false), "light");
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("dark", false), "dark");
    assert.equal(resolveTheme("sepia", true), "sepia");
    assert.equal(nextTheme("system"), "dark");
    assert.equal(nextTheme("dark"), "sepia");
    assert.equal(nextTheme("sepia"), "system");
    const store = memoryStore();
    assert.equal(loadThemeChoice(store), "system");
    saveThemeChoice("sepia", store);
    assert.equal(store.getItem(THEME_KEY), "sepia");
    assert.equal(loadThemeChoice(store), "sepia");
  });
});
