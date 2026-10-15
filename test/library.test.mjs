import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLibrary, bookHasAudio, bookHasEbook } from "../docs/library.js?v=1";
import { loadDriveEntries } from "../docs/drive.js?v=1";
import { readBadge, seriesChips } from "../docs/catalog.js?v=1";
import { FIXTURE_BOOKS, fixtureEntries } from "./library-fixture.mjs";
import { FIXTURE_TOKEN, buildDriveTree, fakeDriveFetch } from "./fake-drive.mjs";

describe("fixture Library pairing (listen/ + ebooks/)", () => {
  const books = buildLibrary(fixtureEntries());

  it("finds every fixture book with the expected id", () => {
    assert.deepEqual(books.map((b) => b.id).sort(), FIXTURE_BOOKS.map((b) => b.id).sort());
  });

  it("pairs each EPUB with its audio, and leaves ebook-only books readable", () => {
    for (const spec of FIXTURE_BOOKS) {
      const book = books.find((b) => b.id === spec.id);
      assert.ok(bookHasEbook(book), `${spec.id} has no ebook`);
      assert.equal(bookHasAudio(book), spec.audio.length > 0, `${spec.id} audio`);
      assert.equal(book.chapters.length, spec.audio.length);
    }
    assert.equal(readBadge(books.find((b) => b.id === "thing-explainer/thing-explainer")), "可讀");
    assert.equal(readBadge(books.find((b) => b.id === "munroe/what-if-1")), "可聽讀");
  });

  it("makes one chip per series plus 全部", () => {
    const chips = seriesChips(books);
    assert.equal(chips[0].title, "全部");
    assert.deepEqual(
      chips.slice(1).map((c) => c.title),
      ["上學不容易", "門羅 What If", "Immune", "Thing Explainer"]
    );
  });
});

describe("Drive walk over the fake Drive (same calls the site makes)", () => {
  it("finds Library, walks it with paging, skips _source and dot files", async () => {
    const tree = buildDriveTree();
    const log = [];
    const fetchImpl = fakeDriveFetch(tree, log);
    const walked = await loadDriveEntries({ token: FIXTURE_TOKEN, fetchImpl });
    assert.equal(walked.folder.id, "fx-root-library");
    assert.ok(walked.entries.every((e) => !e.path.includes("_source") && !e.path.includes(".DS_Store")));
    const books = buildLibrary(walked.entries);
    assert.deepEqual(books.map((b) => b.id).sort(), FIXTURE_BOOKS.map((b) => b.id).sort());
    assert.ok(log.some((l) => l.includes("sharedWithMe")), "also searched Shared with me");
  });

  it("rejects a missing token the way Drive does", async () => {
    await assert.rejects(
      loadDriveEntries({ token: "wrong", fetchImpl: fakeDriveFetch() }),
      (err) => err.kind === "expired"
    );
  });
});
