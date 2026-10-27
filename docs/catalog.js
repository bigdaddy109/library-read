/** Shelf helpers: series colours, chips, filter, cover-open motion. Safe to import from Node tests. */

import { bookHasAudio, bookHasEbook } from "./library.js?v=13";
import { filterBooks, shelfCountLabel, emptySearchMessage, trimQuery } from "./search.js?v=13";

/**
 * Cover wall → book (same as Library Listen's openCoverBook):
 * 1) the tapped cover zooms onto the closed-book position;
 * 2) the front board swings open to the LEFT on its spine hinge
 *    (rotateY 0 → −90 → −180), revealing the inner page (讀 / 邊聽邊讀).
 * Closing runs the same frames backwards. Transform + opacity only.
 */
export const COVER_MORPH = {
  openMs: 400,
  closeMs: 340,
  easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  flipDelayMs: 140,
  flipMs: 900,
  flipCloseMs: 680,
  flipEasing: "cubic-bezier(0.45, 0.05, 0.18, 1)",
};

export function reverseFrames(frames) {
  return [...frames]
    .reverse()
    .map((f) => (f.offset == null ? f : { ...f, offset: 1 - f.offset }));
}

/**
 * Keyframes for the board swing; `opening: false` is the exact reverse.
 * Faces swap by opacity at the edge-on midpoint so engines that flatten 3D
 * never show a mirrored cover.
 */
export function bookFlipFrames(opening = true) {
  const frames = {
    leaf: [
      { transform: "rotateY(0deg)", offset: 0 },
      { transform: "rotateY(-90deg)", offset: 0.5 },
      { transform: "rotateY(-180deg)", offset: 1 },
    ],
    spread: [
      { transform: "translateX(-25%)", offset: 0 },
      { transform: "translateX(-12%)", offset: 0.5 },
      { transform: "translateX(0)", offset: 1 },
    ],
    endpaper: [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.5 },
      { opacity: 1, offset: 1 },
    ],
    front: [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.5 },
      { opacity: 0, offset: 0.5 },
      { opacity: 0, offset: 1 },
    ],
    back: [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.5 },
      { opacity: 1, offset: 0.5 },
      { opacity: 1, offset: 1 },
    ],
    pageShade: [
      { opacity: 1, offset: 0 },
      { opacity: 0.9, offset: 0.45 },
      { opacity: 0, offset: 1 },
    ],
    frontShade: [
      { opacity: 0, offset: 0 },
      { opacity: 0.2, offset: 0.5 },
      { opacity: 0.35, offset: 1 },
    ],
    backShade: [
      { opacity: 0.35, offset: 0 },
      { opacity: 0.15, offset: 0.5 },
      { opacity: 0, offset: 1 },
    ],
  };
  if (opening) return frames;
  return Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, reverseFrames(f)]));
}

function usableRect(rect) {
  return (
    !!rect &&
    [rect.left, rect.top, rect.width, rect.height].every((n) => Number.isFinite(n)) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** Transform (origin 0 0) that draws an element laid out at `to` over the `from` box. */
export function coverMorphTransform(from, to) {
  if (!usableRect(from) || !usableRect(to)) return null;
  const x = from.left - to.left;
  const y = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const r = (n) => Math.round(n * 1000) / 1000;
  return {
    x: r(x),
    y: r(y),
    sx: r(sx),
    sy: r(sy),
    css: `translate(${r(x)}px, ${r(y)}px) scale(${r(sx)}, ${r(sy)})`,
  };
}

/** Same series palette as Library Listen's shelf. */
export const SERIES = {
  school: {
    id: "school",
    title: "上學不容易",
    author: "Library",
    accent: "#c45c3e",
    ink: "#5a2a1c",
    paper: "#f3e4d4",
    cloth: "#b4532f",
  },
  munroe: {
    id: "munroe",
    title: "門羅 What If",
    author: "Randall Munroe",
    accent: "#3d6b6a",
    ink: "#1d3333",
    paper: "#dce8e4",
    cloth: "#2f5857",
  },
  immune: {
    id: "immune",
    title: "Immune",
    author: "Philipp Dettmer",
    accent: "#8b3a4a",
    ink: "#3a1520",
    paper: "#f0dce0",
    cloth: "#7a3040",
  },
};

export const SERIES_ORDER = ["school", "munroe", "immune"];

export function hashString(value) {
  let h = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seriesIdForBook(book) {
  const hay = [book?.collectionId, book?.collectionTitle, book?.folder, book?.id, book?.title]
    .map((s) => String(s || ""))
    .join(" ");
  if (/immune/i.test(hay)) return "immune";
  if (/munroe|whatif|what-if|門羅/i.test(hay)) return "munroe";
  if (/上學|school/i.test(hay)) return "school";
  return String(book?.collectionId || "").toLowerCase() || "other";
}

/** Stable muted palette for series Library Listen has no colour for. */
function otherSeries(id, title) {
  const hues = [28, 200, 140, 260, 340, 90];
  const hue = hues[hashString(id) % hues.length];
  return {
    id: id || "other",
    title: title || "其他",
    author: "Unknown",
    accent: `hsl(${hue} 32% 38%)`,
    ink: `hsl(${hue} 30% 16%)`,
    paper: `hsl(${hue} 30% 89%)`,
    cloth: `hsl(${hue} 28% 34%)`,
  };
}

export function seriesMeta(bookOrId) {
  const id = typeof bookOrId === "string" ? bookOrId : seriesIdForBook(bookOrId);
  if (SERIES[id]) return SERIES[id];
  const title = typeof bookOrId === "object" ? bookOrId?.collectionTitle : "";
  return otherSeries(id, title);
}

export function seriesChips(books) {
  const list = Array.isArray(books) ? books : [];
  const counts = new Map();
  const sample = new Map();
  for (const book of list) {
    const id = seriesIdForBook(book);
    counts.set(id, (counts.get(id) || 0) + 1);
    if (!sample.has(id)) sample.set(id, book);
  }
  const chips = [{ id: "all", title: "全部", count: list.length, accent: "#1c1914" }];
  const seen = new Set();
  for (const id of SERIES_ORDER) {
    if (!counts.has(id)) continue;
    seen.add(id);
    chips.push({ ...seriesMeta(id), count: counts.get(id) });
  }
  for (const [id, count] of counts) {
    if (seen.has(id)) continue;
    chips.push({ ...seriesMeta(sample.get(id)), count });
  }
  return chips;
}

export function filterShelf(books, { query = "", seriesId = "all" } = {}) {
  const list = Array.isArray(books) ? books : [];
  const narrowed =
    seriesId && seriesId !== "all" ? list.filter((book) => seriesIdForBook(book) === seriesId) : list;
  return filterBooks(narrowed, query);
}

/** Read-first badge: 可聽讀 (text + audio), 可讀 (text only), 只有音訊 (audio only). */
export function readBadge(book) {
  const audio = bookHasAudio(book);
  const read = bookHasEbook(book);
  if (audio && read) return "可聽讀";
  if (read) return "可讀";
  return "只有音訊";
}

export function mediaFlags(book) {
  return { audio: bookHasAudio(book), read: bookHasEbook(book), badge: readBadge(book) };
}

/** Readable books first; audio-only books stay listed so the shelf matches the Library. */
export function readOrder(books) {
  return [...(books || [])].sort((a, b) => {
    const ar = bookHasEbook(a) ? 0 : 1;
    const br = bookHasEbook(b) ? 0 : 1;
    return ar - br;
  });
}

export function shelfStatusLabel(count, query, seriesId) {
  const base = shelfCountLabel(count, query);
  if (seriesId && seriesId !== "all" && !trimQuery(query)) return `${base} · ${seriesMeta(seriesId).title}`;
  return base;
}

export function emptyShelfMessage(query, seriesId) {
  const searchEmpty = emptySearchMessage(query);
  if (searchEmpty) return searchEmpty;
  if (seriesId && seriesId !== "all") return "這個系列還沒有書。";
  return "";
}
