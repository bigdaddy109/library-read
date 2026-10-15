/**
 * Listen-along v1: chapter-level alignment between audio tracks and EPUB text.
 * No timestamps exist, so a track maps to a text chapter by TOC title, else
 * by equal count, else proportionally. A per-book offset (set by the reader
 * with 對齊到這一章) shifts the whole mapping. Pure; safe for Node tests.
 */
import { chapterMatchCore, spineIndexForChapter } from "./epub.js?v=1";

export const ALIGN_KEY = "libraryread.align.v1";

/**
 * Text chapters for alignment and the 目錄: spine items that have a TOC title.
 * Untitled spine items (cover, title page) still render while paging; they
 * just are not alignment targets. Falls back to every spine item.
 * @param {{ index: number, title?: string }[]} spine
 */
export function textChapters(spine) {
  const items = Array.isArray(spine) ? spine : [];
  const titled = items.filter((item) => item?.title && item.title.trim());
  const list = titled.length ? titled : items;
  return list.map((item, i) => ({
    index: i,
    spineIndex: item.index,
    title: item.title?.trim() || `第 ${i + 1} 節`,
  }));
}

/** Text chapter (index into textChapters) whose spine range contains spineIndex. */
export function textChapterForSpine(chapters, spineIndex) {
  const list = Array.isArray(chapters) ? chapters : [];
  let found = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spineIndex <= spineIndex) found = i;
    else break;
  }
  return found;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Text chapter index for audio track `audioIndex`, before the user offset. */
export function baseTextIndexForAudio(chapters, tracks, audioIndex) {
  const list = Array.isArray(chapters) ? chapters : [];
  if (!list.length) return 0;
  return clamp(spineIndexForChapter(list, tracks, audioIndex), 0, list.length - 1);
}

export function textIndexForAudio(chapters, tracks, audioIndex, offset = 0) {
  const list = Array.isArray(chapters) ? chapters : [];
  if (!list.length) return 0;
  const base = baseTextIndexForAudio(list, tracks, audioIndex);
  return clamp(base + (Number(offset) || 0), 0, list.length - 1);
}

/** The last track whose mapped text chapter is at or before textIndex. */
export function audioIndexForText(chapters, tracks, textIndex, offset = 0) {
  const n = Array.isArray(tracks) ? tracks.length : 0;
  if (!n) return 0;
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    if (textIndexForAudio(chapters, tracks, i, offset) <= textIndex) best = i;
  }
  return best;
}

/** Offset that makes the current track line up with the text chapter on screen. */
export function offsetToAlign(chapters, tracks, audioIndex, textIndex) {
  return textIndex - baseTextIndexForAudio(chapters, tracks, audioIndex);
}

/** How a track was matched, for the hint under the listen bar. */
export function alignmentKind(chapters, tracks) {
  const list = Array.isArray(chapters) ? chapters : [];
  const t = Array.isArray(tracks) ? tracks : [];
  if (!list.length || !t.length) return "none";
  if (t.length === 1) return "single";
  const cores = new Set(list.map((ch) => chapterMatchCore(ch.title)).filter(Boolean));
  if (t.some((track) => cores.has(chapterMatchCore(track?.title)))) return "title";
  if (t.length === list.length) return "count";
  return "ratio";
}

export const ALIGNMENT_LABELS = {
  none: "",
  single: "一個音檔對整本書",
  title: "依章名對齊",
  count: "依章節順序對齊",
  ratio: "依比例對齊（音檔與章節數不同）",
};

function defaultStore() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadOffset(bookId, store = defaultStore()) {
  try {
    const all = JSON.parse(store?.getItem(ALIGN_KEY) || "{}");
    const n = Number(all?.[bookId]);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveOffset(bookId, offset, store = defaultStore()) {
  if (!store) return;
  try {
    const all = JSON.parse(store.getItem(ALIGN_KEY) || "{}");
    if (offset) all[bookId] = offset;
    else delete all[bookId];
    store.setItem(ALIGN_KEY, JSON.stringify(all));
  } catch {
    /* private mode / quota */
  }
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
