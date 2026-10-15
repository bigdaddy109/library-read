import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEpub } from "../docs/epub.js?v=1";
import {
  alignmentKind,
  audioIndexForText,
  formatTime,
  loadOffset,
  offsetToAlign,
  saveOffset,
  textChapterForSpine,
  textChapters,
  textIndexForAudio,
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
