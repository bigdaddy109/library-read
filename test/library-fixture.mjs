/**
 * Multi-series fixture that mimics Jeff's Drive `Library` folder:
 * series folders with listen/ audio and ebooks/ EPUBs. Generated text and
 * silent audio only.
 */
import { buildEpub } from "./epub-builder.mjs";

/** Book specs: what the e2e suite opens per series, and what the text should say. */
export const FIXTURE_BOOKS = [
  {
    series: "上學不容易",
    id: "school/middle-school-01-first-day",
    title: "Middle School 01 First Day",
    epub: {
      title: "上學不容易 1：開學第一天",
      author: "示範作者",
      lang: "zh",
      hostile: true,
      chapters: [
        { title: "第一章 走進校門", marker: "【校門】", paragraphs: 22 },
        { title: "第二章 新同學", marker: "【同學】", paragraphs: 18 },
        { title: "第三章 放學", marker: "【放學】", paragraphs: 16 },
      ],
    },
    audio: ["01.mp3", "02.mp3", "03.mp3"],
    audioDir: "Library/上學不容易/listen/Middle School 01 First Day",
    epubPath: "Library/上學不容易/ebooks/Middle School 01 First Day.epub",
  },
  {
    series: "上學不容易",
    id: "school/middle-school-02-get-me",
    title: "Middle School 02 Get Me",
    epub: {
      title: "上學不容易 2",
      author: "示範作者",
      lang: "zh",
      chapters: [
        { title: "第一章 早自習", marker: "【早自習】" },
        { title: "第二章 午餐", marker: "【午餐】" },
      ],
    },
    audio: ["01.mp3", "02.mp3"],
    audioDir: "Library/上學不容易/listen/Middle School 02 Get Me",
    epubPath: "Library/上學不容易/ebooks/Middle School 02 Get Me.epub",
  },
  {
    series: "門羅-WhatIf",
    id: "munroe/what-if-1",
    title: "What If?",
    epub: {
      title: "What If? (fixture)",
      author: "Fixture Author",
      lang: "en",
      hostile: true,
      chapters: [
        { title: "Introduction", marker: "[Intro]", paragraphs: 16 },
        { title: "Global Windstorm", marker: "[Windstorm]", paragraphs: 16 },
        { title: "Relativistic Baseball", marker: "[Baseball]", paragraphs: 16 },
      ],
    },
    audio: ["01 - Introduction.mp3", "02 - Global Windstorm.mp3", "03 - Relativistic Baseball.mp3"],
    audioDir: "Library/門羅-WhatIf/listen/what-if-1",
    epubPath: "Library/門羅-WhatIf/ebooks/what-if-1.epub",
  },
  {
    series: "門羅-WhatIf",
    id: "munroe/how-to",
    title: "How To",
    epub: {
      title: "How To (fixture)",
      author: "Fixture Author",
      lang: "en",
      chapters: [
        { title: "How to Jump Really High", marker: "[Jump]" },
        { title: "How to Throw a Pool Party", marker: "[Pool]" },
      ],
    },
    audio: ["How To - Randall Munroe.m4b"],
    audioDir: "Library/門羅-WhatIf/listen/how-to",
    epubPath: "Library/門羅-WhatIf/ebooks/how-to.epub",
  },
  {
    series: "Immune",
    id: "immune/immune",
    title: "Immune",
    epub: {
      title: "Immune (fixture)",
      author: "Fixture Author",
      lang: "en",
      chapters: [
        { title: "The Battlefield", marker: "[Battlefield]", paragraphs: 10 },
        { title: "The Soldiers", marker: "[Soldiers]", paragraphs: 10 },
        { title: "The Messengers", marker: "[Messengers]", paragraphs: 10 },
        { title: "The Generals", marker: "[Generals]", paragraphs: 10 },
        { title: "The Memory", marker: "[Memory]", paragraphs: 10 },
        { title: "The Future", marker: "[Future]", paragraphs: 10 },
      ],
    },
    audio: ["Immune-Part01.mp3", "Immune-Part02.mp3", "Immune-Part03.mp3"],
    audioDir: "Library/Immune/listen",
    epubPath: "Library/Immune/ebooks/Immune.epub",
  },
  {
    series: "Thing Explainer",
    id: "thing-explainer/thing-explainer",
    title: "Thing Explainer",
    epub: {
      title: "Thing Explainer (fixture)",
      author: "Fixture Author",
      lang: "en",
      chapters: [
        { title: "Sky Boat", marker: "[SkyBoat]" },
        { title: "Big Tall Wood", marker: "[TallWood]" },
      ],
    },
    audio: [],
    epubPath: "Library/Thing Explainer/ebooks/Thing Explainer.epub",
  },
];

/** One opened book per series. */
export const SERIES_PICKS = [
  "school/middle-school-01-first-day",
  "munroe/what-if-1",
  "immune/immune",
  "thing-explainer/thing-explainer",
];

/** Flat Drive-like file list: { path, size, kind, bookId }. */
export function fixtureFiles() {
  const files = [];
  for (const book of FIXTURE_BOOKS) {
    for (const name of book.audio) {
      files.push({ path: `${book.audioDir}/${name}`, kind: "audio", bookId: book.id, size: 24_000 });
    }
    files.push({ path: book.epubPath, kind: "epub", bookId: book.id, size: 8_000 });
  }
  files.push({ path: "Library/上學不容易/_source/raw-notes.epub", kind: "epub", bookId: null, size: 9_000 });
  files.push({ path: "Library/Immune/listen/.DS_Store", kind: "other", bookId: null, size: 10 });
  return files;
}

export function fixtureEpubBytes(bookId) {
  const book = FIXTURE_BOOKS.find((b) => b.id === bookId);
  if (!book) throw new Error(`No fixture book ${bookId}`);
  return buildEpub(book.epub);
}

/** {path, file} entries the way drive.js hands them to buildLibrary. */
export function fixtureEntries() {
  return fixtureFiles()
    .filter((f) => !f.path.split("/").some((p) => p.startsWith("_") || p.startsWith(".")))
    .map((f, i) => ({
      path: f.path,
      file: { name: f.path.split("/").pop(), size: f.size, driveId: `fx-${i}` },
    }));
}
