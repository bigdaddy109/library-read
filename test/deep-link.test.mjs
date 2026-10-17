import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseEpub } from "../docs/epub.js?v=1";
import { textChapters } from "../docs/listen.js?v=1";
import { buildLibrary } from "../docs/library.js?v=1";
import { DRIVE_SEEN_KEY, DRIVE_SESSION_KEY, beginInteractiveSignIn, clearAccessToken, freshAccessToken } from "../docs/drive.js?v=1";
import {
  LINK_MISSING_MESSAGE,
  LINK_OPEN_LABEL,
  LINK_SIGN_IN_LABEL,
  createDeepLinkSession,
  findLinkedBook,
  parseDeepLink,
  spineIndexForDeepLink,
} from "../docs/link.js?v=1";
import { fixtureEntries, fixtureEpubBytes } from "./library-fixture.mjs";

function installGis(prompts) {
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(opts) {
          return {
            requestAccessToken(arg) {
              const prompt = arg && Object.prototype.hasOwnProperty.call(arg, "prompt") ? arg.prompt : "(missing)";
              prompts.push(prompt);
              setTimeout(() => opts.callback?.({ access_token: "gis-token", expires_in: 3600 }), 0);
            },
          };
        },
      },
    },
  };
}

describe("deep link query", () => {
  it("parses an encoded series, epub stem, and 1-based chapter", () => {
    const link = parseDeepLink(
      "?series=%E4%B8%8A%E5%AD%B8%E4%B8%8D%E5%AE%B9%E6%98%93&book=Middle%20School%2001%20First%20Day&ch=2"
    );
    assert.deepEqual(link, {
      series: "上學不容易",
      book: "Middle School 01 First Day",
      chapter: 2,
    });
    const books = buildLibrary(fixtureEntries());
    assert.equal(findLinkedBook(books, link).id, "school/middle-school-01-first-day");
  });

  it("omits ch as open-at-start and ignores a link with no book", () => {
    assert.equal(parseDeepLink("?series=Immune&book=Immune").chapter, null);
    assert.equal(parseDeepLink("?series=Immune&book=Immune&ch=0").chapter, null);
    assert.equal(parseDeepLink("?series=Immune"), null);
    assert.equal(parseDeepLink(""), null);
  });

  it("matches the Drive series folder even when the shelf title differs", () => {
    const books = buildLibrary(fixtureEntries());
    const link = parseDeepLink("?series=%E9%96%80%E7%BE%85-WhatIf&book=what-if-1&ch=3");
    assert.equal(findLinkedBook(books, link).id, "munroe/what-if-1");
    assert.equal(link.chapter, 3);
  });
});

describe("deep link chapter", () => {
  it("ch jumps to that text chapter and a missing ch stays at the start", async () => {
    const epub = await parseEpub(fixtureEpubBytes("immune/immune"));
    const chapters = textChapters(epub.spine);
    assert.equal(chapters[1].title, "The Soldiers");
    assert.equal(spineIndexForDeepLink(chapters, 2), chapters[1].spineIndex);
    assert.equal(spineIndexForDeepLink(chapters, 1), chapters[0].spineIndex);
    assert.equal(spineIndexForDeepLink(chapters, null), null);
    assert.equal(spineIndexForDeepLink(chapters, 99), null);
  });
});

describe("deep link sign-in", { concurrency: false }, () => {
  afterEach(() => {
    clearAccessToken();
    try {
      localStorage.removeItem(DRIVE_SEEN_KEY);
      localStorage.removeItem(DRIVE_SESSION_KEY);
    } catch {
      /* no localStorage */
    }
  });

  it("does not call requestAccessToken until the button tap, then opens after sign-in", async () => {
    const prompts = [];
    installGis(prompts);
    clearAccessToken();
    const opened = [];
    const session = createDeepLinkSession({
      isSignedIn: () => !!freshAccessToken(),
      beginInteractiveSignIn,
      ensureLibrary: async () => {},
      findBook: () => ({ id: "immune/immune" }),
      openBook: async (_book, opts) => opened.push(opts),
    });
    session.load(parseDeepLink("?series=Immune&book=Immune&ch=2"));
    assert.equal(session.buttonLabel(), LINK_SIGN_IN_LABEL);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(prompts, []);
    const result = await session.activate();
    assert.equal(result.status, "opened");
    assert.equal(result.chapter, 2);
    assert.deepEqual(opened, [{ chapter: 2 }]);
    assert.deepEqual(prompts, ["consent"]);
  });

  it("a return visit from Library Listen tries a silent prompt before consent", async () => {
    const data = new Map();
    globalThis.localStorage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
    localStorage.setItem(DRIVE_SEEN_KEY, "1");
    const prompts = [];
    installGis(prompts);
    clearAccessToken();
    const session = createDeepLinkSession({
      isSignedIn: () => !!freshAccessToken(),
      beginInteractiveSignIn,
      ensureLibrary: async () => {},
      findBook: () => ({ id: "immune/immune" }),
      openBook: async () => {},
    });
    session.load(parseDeepLink("?series=Immune&book=Immune&ch=2"));
    const result = await session.activate();
    assert.equal(result.status, "opened");
    assert.deepEqual(prompts, [""]);
  });

  it("when already signed in, the tap opens the book and does not request a token", async () => {
    const prompts = [];
    installGis(prompts);
    await beginInteractiveSignIn();
    prompts.length = 0;
    const opened = [];
    const session = createDeepLinkSession({
      isSignedIn: () => !!freshAccessToken(),
      beginInteractiveSignIn,
      ensureLibrary: async () => {},
      findBook: (link) => findLinkedBook(buildLibrary(fixtureEntries()), link),
      openBook: async (book, opts) => opened.push({ id: book.id, chapter: opts.chapter }),
    });
    session.load(parseDeepLink("?series=Immune&book=Immune"));
    assert.equal(session.buttonLabel(), LINK_OPEN_LABEL);
    const result = await session.activate();
    assert.equal(result.status, "opened");
    assert.deepEqual(opened, [{ id: "immune/immune", chapter: null }]);
    assert.deepEqual(prompts, []);
  });

  it("a missing book returns to the shelf with a Traditional Chinese message and no popup", async () => {
    const prompts = [];
    const session = createDeepLinkSession({
      isSignedIn: () => true,
      beginInteractiveSignIn: () => {
        prompts.push("consent");
        return Promise.resolve("nope");
      },
      ensureLibrary: async () => {},
      findBook: () => null,
      openBook: async () => {
        throw new Error("should not open");
      },
    });
    session.load(parseDeepLink("?series=Nope&book=Missing"));
    const result = await session.activate();
    assert.equal(result.status, "missing");
    assert.equal(result.message, LINK_MISSING_MESSAGE);
    assert.match(result.message, /書架/);
    assert.deepEqual(prompts, []);
    assert.equal(session.hasTarget(), false);
  });
});
