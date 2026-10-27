/**
 * Listen-along: chapter alignment, plus a proportional page estimate inside
 * the chapters one audio file covers (a whole book, or a single chapter).
 * No timestamps exist, so a track maps to a text chapter by TOC title, else
 * by equal count, else proportionally. A per-book offset (set by the reader
 * with 對齊到這一章) shifts the whole mapping. Pure; safe for Node tests.
 */
import { chapterMatchCore, spineIndexForChapter } from "./epub.js?v=13";

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

/**
 * Text chapters this audio file is responsible for.
 * One file for the book covers every chapter. One file per chapter covers that
 * chapter only. A shorter part covers the chapters until the next track.
 */
export function trackChapterSpan(chapters, tracks, audioIndex, offset = 0) {
  const list = Array.isArray(chapters) ? chapters : [];
  const n = list.length;
  if (!n) return { start: 0, count: 0 };
  const start = textIndexForAudio(list, tracks, audioIndex, offset);
  const trackCount = Array.isArray(tracks) ? tracks.length : 0;
  const next = audioIndex + 1 < trackCount ? textIndexForAudio(list, tracks, audioIndex + 1, offset) : n;
  const count = Math.max(1, Math.min(n - start, next - start));
  return { start, count };
}

/** Page index for a 0–1 position inside a chapter. Spreads land on even pages. */
export function pageIndexForFraction(fraction, pages, spread = false) {
  const count = Math.max(1, Number(pages) || 1);
  if (count <= 1) return 0;
  const f = clamp(Number(fraction) || 0, 0, 1);
  let page = Math.round(f * (count - 1));
  if (spread) page -= page % 2;
  const last = count - 1;
  const lastStart = spread ? last - (last % 2) : last;
  return Math.max(0, Math.min(page, lastStart));
}

/**
 * Where playback should turn the text.
 * Returns null unless the estimate is at least one page ahead of the current
 * view (a spread already shows the facing page, so that needs a full turn).
 * A later chapter is ahead; an earlier one is not pulled back.
 * `page` is set only when the target is the chapter already on screen.
 * Otherwise the caller lays that chapter out and applies `local`.
 */
export function followPageTarget({
  fraction,
  scopeStart = 0,
  scopeCount = 1,
  atSpine = 0,
  atPage = 0,
  pages = 1,
  spread = false,
  spines = [],
} = {}) {
  const count = Math.max(1, scopeCount | 0);
  const start = Math.max(0, scopeStart | 0);
  const f = clamp(Number(fraction) || 0, 0, 1);
  const pos = Math.min(count - 1e-9, f * count);
  const rel = Math.min(count - 1, Math.floor(pos));
  const local = pos - rel;
  const chapter = start + rel;
  const spine = spines[chapter];
  if (!Number.isInteger(spine)) return null;
  if (spine < atSpine) return null;
  if (spine > atSpine) return { chapter, spine, local, page: null };
  const estimate = pageIndexForFraction(local, pages, spread);
  const step = spread ? 2 : 1;
  const current = spread ? atPage - (atPage % 2) : Math.max(0, atPage | 0);
  if (estimate >= current + step) return { chapter, spine, local, page: estimate };
  return null;
}

/** 0–1 position along a horizontal bar. Width 0 stays at the start. */
export function scrubFraction(clientX, left, width) {
  if (!(Number(width) > 0)) return 0;
  return clamp((Number(clientX) - Number(left)) / Number(width), 0, 1);
}

/**
 * A drag only previews. `seek` is true on release, never on move, so a long
 * file does not issue a Drive Range request for every pointer step.
 */
export function createScrub() {
  let fraction = null;
  return {
    get active() {
      return fraction != null;
    },
    get fraction() {
      return fraction;
    },
    down(next) {
      fraction = clamp(Number(next) || 0, 0, 1);
      return { seek: false, fraction };
    },
    move(next) {
      if (fraction == null) return { seek: false, fraction: null };
      fraction = clamp(Number(next) || 0, 0, 1);
      return { seek: false, fraction };
    },
    up() {
      if (fraction == null) return { seek: false, fraction: null };
      const committed = fraction;
      fraction = null;
      return { seek: true, fraction: committed };
    },
    cancel() {
      fraction = null;
      return { seek: false, fraction: null };
    },
  };
}

export function secondsForFraction(fraction, duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return clamp(Number(fraction) || 0, 0, 1) * d;
}

/** Media Session position, or null until duration is known. Clamped into the file. */
export function mediaPositionState({ duration, currentTime, playbackRate = 1 } = {}) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return null;
  const rate = Number(playbackRate);
  return {
    duration: d,
    playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    position: clamp(Number(currentTime) || 0, 0, d),
  };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
