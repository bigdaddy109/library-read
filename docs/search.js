/** Shelf search — same fields and hit line as native `ShelfView`. */

export function trimQuery(query) {
  return String(query ?? "").trim();
}

/** Case- and diacritic-insensitive fold, close to `localizedStandardContains`. */
export function foldForSearch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

export function fieldContains(haystack, query) {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return foldForSearch(haystack).includes(needle);
}

function bookFields(book) {
  return [
    book?.title,
    book?.author,
    book?.collectionTitle,
    book?.subtitle,
    book?.folder ?? book?.folderName,
  ];
}

export function bookMatches(book, query) {
  const q = trimQuery(query);
  if (!q) return true;
  if (bookFields(book).some((field) => fieldContains(field, q))) return true;
  return (book?.chapters || []).some((ch) => fieldContains(ch?.title, q));
}

export function matchingChapterTitles(book, query) {
  const q = trimQuery(query);
  if (!q) return [];
  return (book?.chapters || [])
    .map((ch) => ch?.title)
    .filter((title) => title && fieldContains(title, q));
}

/** At most two matching chapter names, then `· +N`. */
export function chapterHitLine(titles) {
  const list = (titles || []).filter(Boolean);
  if (!list.length) return "";
  const shown = list.slice(0, 2).join(" · ");
  const extra = list.length - 2;
  return extra > 0 ? `${shown} · +${extra}` : shown;
}

export function filterBooks(books, query) {
  const list = Array.isArray(books) ? books : [];
  if (!trimQuery(query)) return list;
  return list.filter((book) => bookMatches(book, query));
}

export function shelfCountLabel(count, query) {
  const n = Number.isFinite(count) ? count : 0;
  return trimQuery(query) ? `${n} 本符合` : `${n} 本書`;
}

export function emptySearchMessage(query) {
  const q = trimQuery(query);
  return q ? `沒有符合「${q}」的書。` : "";
}
