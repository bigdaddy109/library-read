import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEpub } from "../docs/epub.js?v=1";
import {
  alignmentKind,
  audioIndexForText,
  followPageTarget,
  formatTime,
  loadOffset,
  offsetToAlign,
  createScrub,
  mediaPositionState,
  pageIndexForFraction,
  saveOffset,
  scrubFraction,
  secondsForFraction,
  textChapterForSpine,
  textChapters,
  textIndexForAudio,
  trackChapterSpan,
} from "../docs/listen.js?v=1";
import { FIXTURE_BOOKS, fixtureEpubBytes } from "./library-fixture.mjs";
import { titleFromFilename } from "../docs/library.js?v=1";

async function fixture(id) {
  const spec = FIXTURE_BOOKS.find((b) => b.id === id);
  const epub = await parseEpub(fixtureEpubBytes(id));
  return {
    chapters: textChapters(epub.spine),
    tracks: spec.audio.map((name) => ({ id: name, title: titleFromFilename(name) })),
    epub,
  };
}

describe("text chapters", () => {
  it("uses TOC-titled spine items and skips the untitled title page", async () => {
    const { chapters, epub } = await fixture("munroe/what-if-1");
    assert.equal(epub.spine.length, 4);
    assert.deepEqual(chapters.map((c) => c.title), ["Introduction", "Global Windstorm", "Relativistic Baseball"]);
    assert.deepEqual(chapters.map((c) => c.spineIndex), [1, 2, 3]);
    assert.equal(textChapterForSpine(chapters, 0), 0);
    assert.equal(textChapterForSpine(chapters, 3), 2);
  });

  it("falls back to every spine item when there is no TOC", () => {
    const chapters = textChapters([{ index: 0 }, { index: 1 }]);
    assert.deepEqual(chapters.map((c) => c.title), ["第 1 節", "第 2 節"]);
  });
});

describe("audio ↔ text (chapter level)", () => {
  it("matches by title when track names are chapter names", async () => {
    const { chapters, tracks } = await fixture("munroe/what-if-1");
    assert.equal(alignmentKind(chapters, tracks), "title");
    assert.deepEqual([0, 1, 2].map((i) => textIndexForAudio(chapters, tracks, i)), [0, 1, 2]);
  });

  it("matches by order when counts are equal (Chinese titles, 01.mp3 tracks)", async () => {
    const { chapters, tracks } = await fixture("school/middle-school-01-first-day");
    assert.equal(alignmentKind(chapters, tracks), "count");
    assert.deepEqual([0, 1, 2].map((i) => textIndexForAudio(chapters, tracks, i)), [0, 1, 2]);
  });

  it("spreads 3 parts over 6 chapters proportionally (Immune)", async () => {
    const { chapters, tracks } = await fixture("immune/immune");
    assert.equal(alignmentKind(chapters, tracks), "ratio");
    assert.deepEqual([0, 1, 2].map((i) => textIndexForAudio(chapters, tracks, i)), [0, 3, 5]);
    assert.equal(audioIndexForText(chapters, tracks, 4), 1);
    assert.equal(audioIndexForText(chapters, tracks, 0), 0);
  });

  it("a whole-book m4b maps to the first chapter", async () => {
    const { chapters, tracks } = await fixture("munroe/how-to");
    assert.equal(alignmentKind(chapters, tracks), "single");
    assert.equal(textIndexForAudio(chapters, tracks, 0), 0);
  });

  it("an offset re-anchors every later track, clamped to the book", async () => {
    const { chapters, tracks } = await fixture("immune/immune");
    const offset = offsetToAlign(chapters, tracks, 1, 4);
    assert.equal(offset, 1);
    assert.deepEqual([0, 1, 2].map((i) => textIndexForAudio(chapters, tracks, i, offset)), [1, 4, 5]);
  });

  it("stores the offset per book", () => {
    const mem = new Map();
    const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    saveOffset("immune/immune", 2, store);
    assert.equal(loadOffset("immune/immune", store), 2);
    assert.equal(loadOffset("other", store), 0);
    saveOffset("immune/immune", 0, store);
    assert.equal(loadOffset("immune/immune", store), 0);
  });

  it("formats times", () => {
    assert.equal(formatTime(5), "0:05");
    assert.equal(formatTime(3725), "1:02:05");
  });
});

describe("proportional page follow", () => {
  it("a whole-book file covers every text chapter", async () => {
    const { chapters, tracks } = await fixture("munroe/how-to");
    assert.equal(chapters.length, 2);
    assert.deepEqual(trackChapterSpan(chapters, tracks, 0), { start: 0, count: 2 });
  });

  it("one track per chapter stays inside that chapter", async () => {
    const { chapters, tracks } = await fixture("munroe/what-if-1");
    assert.deepEqual(trackChapterSpan(chapters, tracks, 1), { start: 1, count: 1 });
  });

  it("a part covers the chapters until the next track", async () => {
    const { chapters, tracks } = await fixture("immune/immune");
    assert.deepEqual(trackChapterSpan(chapters, tracks, 0), { start: 0, count: 3 });
    assert.deepEqual(trackChapterSpan(chapters, tracks, 1), { start: 3, count: 2 });
    assert.deepEqual(trackChapterSpan(chapters, tracks, 2), { start: 5, count: 1 });
  });

  it("turns only when the estimate is at least one page ahead", () => {
    const spines = [1];
    assert.equal(pageIndexForFraction(0, 10, false), 0);
    assert.equal(pageIndexForFraction(1, 10, false), 9);
    assert.equal(
      followPageTarget({ fraction: 0.02, scopeStart: 0, scopeCount: 1, atSpine: 1, atPage: 0, pages: 10, spines }),
      null
    );
    const one = followPageTarget({
      fraction: 0.12,
      scopeStart: 0,
      scopeCount: 1,
      atSpine: 1,
      atPage: 0,
      pages: 10,
      spines,
    });
    assert.equal(one.page, 1);
    assert.equal(
      followPageTarget({ fraction: 0.12, scopeStart: 0, scopeCount: 1, atSpine: 1, atPage: 1, pages: 10, spines }),
      null
    );
    assert.equal(
      followPageTarget({ fraction: 0.12, scopeStart: 0, scopeCount: 1, atSpine: 1, atPage: 3, pages: 10, spines }),
      null
    );
  });

  it("a whole-book fraction moves into a later chapter and does not go backward", () => {
    const spines = [1, 2];
    const ahead = followPageTarget({
      fraction: 0.8,
      scopeStart: 0,
      scopeCount: 2,
      atSpine: 1,
      atPage: 0,
      pages: 8,
      spines,
    });
    assert.equal(ahead.chapter, 1);
    assert.equal(ahead.spine, 2);
    assert.equal(ahead.page, null);
    assert.ok(ahead.local > 0.5);
    assert.equal(
      followPageTarget({ fraction: 0.1, scopeStart: 0, scopeCount: 2, atSpine: 2, atPage: 0, pages: 8, spines }),
      null
    );
  });

  it("a spread stays put when the estimate is the facing page already on screen", () => {
    const spines = [1];
    assert.equal(
      followPageTarget({
        fraction: 0.1,
        scopeStart: 0,
        scopeCount: 1,
        atSpine: 1,
        atPage: 0,
        pages: 10,
        spread: true,
        spines,
      }),
      null
    );
    const next = followPageTarget({
      fraction: 0.28,
      scopeStart: 0,
      scopeCount: 1,
      atSpine: 1,
      atPage: 0,
      pages: 10,
      spread: true,
      spines,
    });
    assert.equal(next.page, 2);
  });
});

describe("listen scrub", () => {
  it("previews a drag and seeks only on release", () => {
    const scrub = createScrub();
    assert.deepEqual(scrub.down(0.1), { seek: false, fraction: 0.1 });
    assert.equal(scrub.active, true);
    assert.deepEqual(scrub.move(0.4), { seek: false, fraction: 0.4 });
    assert.deepEqual(scrub.move(0.72), { seek: false, fraction: 0.72 });
    assert.deepEqual(scrub.up(), { seek: true, fraction: 0.72 });
    assert.equal(scrub.active, false);
    assert.deepEqual(scrub.up(), { seek: false, fraction: null });
    assert.equal(scrubFraction(30, 10, 100), 0.2);
    assert.equal(secondsForFraction(0.25, 80), 20);
  });

  it("a cancelled drag does not seek", () => {
    const scrub = createScrub();
    scrub.down(0.2);
    scrub.move(0.9);
    assert.deepEqual(scrub.cancel(), { seek: false, fraction: null });
  });

  it("builds a lock-screen position clamped to the file", () => {
    assert.equal(mediaPositionState({ duration: NaN, currentTime: 1 }), null);
    assert.deepEqual(mediaPositionState({ duration: 20, currentTime: 48, playbackRate: 1.25 }), {
      duration: 20,
      position: 20,
      playbackRate: 1.25,
    });
    assert.deepEqual(mediaPositionState({ duration: 20, currentTime: -4, playbackRate: 0 }), {
      duration: 20,
      position: 0,
      playbackRate: 1,
    });
  });
});
