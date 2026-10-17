/**
 * Reading-comfort helpers. Playback speed and the sleep timer follow
 * Library Listen (docs/app.js: RATES, cycleRate, SLEEP_MINUTES, cycleSleepTimer).
 * Listen opens a book with ?open=<id>; consumeOpenIntent (Listen app.js
 * around 2325–2348) reads that param. The id is the same makeBook id:
 * `${collection.id}/${slug(bookFolder)}`.
 */

export const LISTEN_ORIGIN = "https://bigdaddy109.github.io/library-listen/";
/** The key Jeff named, then the key Library Listen actually writes. */
export const LISTEN_PROGRESS_KEYS = ["librarylisten.progress", "librarylisten.progress.v1"];

export const RATES = [1, 1.25, 1.5];
export const RATE_KEY = "libraryread.rate";
export const SLEEP_MINUTES = [0, 15, 30, 45, 60];
export const THEME_KEY = "libraryread.theme.v1";
export const THEMES = ["system", "dark", "sepia"];

export function listenOpenUrl(bookId, origin = LISTEN_ORIGIN) {
  const url = new URL(origin);
  url.searchParams.set("open", String(bookId || ""));
  return url.href;
}

export function readListenRecord(bookId, store) {
  if (!bookId || !store?.getItem) return null;
  for (const key of LISTEN_PROGRESS_KEYS) {
    let all = null;
    try {
      all = JSON.parse(store.getItem(key) || "null");
    } catch {
      all = null;
    }
    if (all && typeof all === "object" && all[bookId]) return all[bookId];
  }
  return null;
}

/** 1-based chapter, matching the order of book.chapters. */
export function listenHeardChapter(book, record) {
  if (!record || typeof record !== "object") return null;
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];
  const id = typeof record.chapterId === "string" ? record.chapterId : "";
  if (id) {
    const idx = chapters.findIndex((ch) => ch.id === id);
    if (idx >= 0) return idx + 1;
  }
  const direct = Number(record.chapter);
  if (Number.isInteger(direct) && direct >= 1 && direct <= Math.max(chapters.length, direct)) return direct;
  return null;
}

export function listenHeardLabel(chapter) {
  if (!Number.isInteger(chapter) || chapter < 1) return "";
  return `Listen 聽到第 ${chapter} 章`;
}

export function nextRate(current) {
  const index = RATES.indexOf(Number(current));
  return RATES[(index + 1) % RATES.length];
}

export function rateLabel(rate) {
  if (Number(rate) === 1) return "1.0×";
  if (Number(rate) === 1.25) return "1.25×";
  return "1.5×";
}

export function loadRate(store) {
  try {
    const n = Number(store?.getItem?.(RATE_KEY));
    if (RATES.includes(n)) return n;
  } catch {
    /* private mode */
  }
  return 1;
}

export function saveRate(rate, store) {
  try {
    store?.setItem?.(RATE_KEY, String(rate));
  } catch {
    /* private mode */
  }
}

/** Same nearest-then-next cycle as Library Listen's cycleSleepTimer. */
export function nextSleepMinutes(remainingMinutes) {
  const remaining = Math.max(0, Number(remainingMinutes) || 0);
  let nearest = 0;
  for (let i = 0; i < SLEEP_MINUTES.length; i += 1) {
    if (SLEEP_MINUTES[i] >= remaining) {
      nearest = i;
      break;
    }
    nearest = i;
  }
  return SLEEP_MINUTES[(nearest + 1) % SLEEP_MINUTES.length];
}

export function sleepButtonText(minutesLeft) {
  const mins = Math.ceil(Number(minutesLeft) || 0);
  if (mins <= 0) return "睡眠";
  return `${mins} 分`;
}

export function sleepToast(minutes) {
  if (!minutes) return "睡眠計時已關閉";
  return `${minutes} 分鐘後暫停`;
}

export function sleepIsDue(until, now) {
  return until != null && now >= until;
}

export function progressPercent(text) {
  if (!text || !Number.isFinite(Number(text.fraction))) return null;
  return Math.round(Math.min(1, Math.max(0, Number(text.fraction))) * 100);
}

export function progressLineText(text, hasEbook) {
  if (!text) return hasEbook ? "尚未開始" : "這本書沒有電子書，只有音訊。";
  const pct = progressPercent(text);
  const label = text.label || "閱讀中";
  return pct == null ? `讀到：${label}` : `讀到：${label} · ${pct}%`;
}

export function nextTheme(current) {
  const index = THEMES.indexOf(current);
  return THEMES[(index < 0 ? 0 : index + 1) % THEMES.length];
}

export function themeChoiceLabel(choice) {
  if (choice === "dark") return "深色";
  if (choice === "sepia") return "暗褐";
  return "跟隨系統";
}

/** system follows prefers-color-scheme; dark and sepia are explicit. */
export function resolveTheme(choice, prefersDark) {
  if (choice === "dark") return "dark";
  if (choice === "sepia") return "sepia";
  return prefersDark ? "dark" : "light";
}

export function loadThemeChoice(store) {
  try {
    const value = store?.getItem?.(THEME_KEY);
    if (THEMES.includes(value)) return value;
  } catch {
    /* private mode */
  }
  return "system";
}

export function saveThemeChoice(choice, store) {
  try {
    store?.setItem?.(THEME_KEY, choice);
  } catch {
    /* private mode */
  }
}
