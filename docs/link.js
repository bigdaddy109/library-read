/**
 * Deep links from Library Listen:
 * ?series=<Drive series folder>&book=<EPUB file name without .epub>&ch=<1-based chapter>
 * Parsing and matching are pure. Loading a link must not call GIS; the button tap does.
 */
import { KNOWN_COLLECTIONS } from "./library.js?v=9";

export const LINK_MISSING_MESSAGE = "找不到這本書，已回到書架。";
export const LINK_SIGN_IN_LABEL = "用 Google 登入並打開";
export const LINK_OPEN_LABEL = "打開這本書";

function queryFrom(input) {
  if (input == null) return "";
  if (typeof input === "string") {
    const q = input.indexOf("?");
    return q >= 0 ? input.slice(q + 1) : input;
  }
  if (typeof input.search === "string") return queryFrom(input.search);
  return "";
}

/**
 * @param {string | { search?: string } | URLSearchParams} input
 * @returns {{ series: string, book: string, chapter: number | null } | null}
 */
export function parseDeepLink(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(queryFrom(input));
  const series = (params.get("series") || "").normalize("NFC").trim();
  const book = (params.get("book") || "").normalize("NFC").trim();
  if (!series || !book) return null;
  const chRaw = params.get("ch");
  let chapter = null;
  if (chRaw != null && String(chRaw).trim() !== "") {
    const n = Number(String(chRaw).trim());
    if (Number.isInteger(n) && n >= 1) chapter = n;
  }
  return { series, book, chapter };
}

function norm(value) {
  return String(value || "").normalize("NFC").trim().toLowerCase();
}

export function epubStem(book) {
  const name = book?.ebook?.name || book?.ebook?.id || "";
  return String(name).replace(/\.epub$/i, "");
}

/** Folder names and titles that should match `?series=`. */
export function seriesNamesForBook(book, known = KNOWN_COLLECTIONS) {
  const names = [];
  const add = (value) => {
    if (value && !names.includes(value)) names.push(value);
  };
  add(book?.seriesFolder);
  add(book?.collectionTitle);
  for (const [folder, meta] of Object.entries(known || {})) {
    if (meta?.id && meta.id === book?.collectionId) add(folder);
    if (meta?.title && meta.title === book?.collectionTitle) add(folder);
  }
  return names;
}

export function findLinkedBook(books, link, known = KNOWN_COLLECTIONS) {
  if (!link?.series || !link?.book) return null;
  const series = norm(link.series);
  const stem = norm(link.book);
  return (
    (books || []).find((book) => {
      const seriesOk = seriesNamesForBook(book, known).some((name) => norm(name) === series);
      const fileOk = norm(epubStem(book)) === stem || norm(book?.folder) === stem;
      return seriesOk && fileOk;
    }) || null
  );
}

/**
 * 1-based text-chapter index → spine index.
 * `null` chapter (ch omitted) means the caller opens at the start.
 * An out-of-range chapter also returns null so the caller can start at the beginning.
 */
export function spineIndexForDeepLink(textChapterList, chapter) {
  if (chapter == null) return null;
  const n = Number(chapter);
  if (!Number.isInteger(n) || n < 1) return null;
  const item = textChapterList?.[n - 1];
  return item ? item.spineIndex : null;
}

/**
 * Remembers a deep link across sign-in. `load` never calls GIS.
 * `activate` is the button tap: interactive sign-in only when there is no token yet.
 */
export function createDeepLinkSession({
  isSignedIn,
  beginInteractiveSignIn,
  ensureLibrary,
  findBook,
  openBook,
} = {}) {
  let target = null;
  return {
    load(link) {
      target = link || null;
      return target;
    },
    target() {
      return target;
    },
    hasTarget() {
      return !!target;
    },
    buttonLabel() {
      return isSignedIn?.() ? LINK_OPEN_LABEL : LINK_SIGN_IN_LABEL;
    },
    async activate() {
      if (!target) return { status: "idle" };
      if (!isSignedIn?.()) await beginInteractiveSignIn();
      if (ensureLibrary) await ensureLibrary();
      const link = target;
      const book = findBook(link);
      if (!book) {
        target = null;
        return { status: "missing", message: LINK_MISSING_MESSAGE };
      }
      await openBook(book, { chapter: link.chapter ?? null });
      if (target === link) target = null;
      return { status: "opened", chapter: link.chapter ?? null };
    },
  };
}
