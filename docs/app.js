import {
  buildLibrary,
  bookHasAudio,
  bookHasEbook,
  chapterProgress,
  resumeSeconds,
  saveProgress,
  saveTextProgress,
  textProgress,
  loadProgress,
} from "./library.js?v=7";
import {
  DRIVE_ERROR_KIND,
  DRIVE_UNAUTHORIZED_MESSAGE,
  beginInteractiveSignIn,
  classifyDriveError,
  clearAccessToken,
  clearDriveSession,
  downloadDriveBuffer,
  driveMediaUrl,
  fetchDriveUser,
  freshAccessToken,
  getAccessToken,
  isGoogleClientConfigured,
  isPickerConfigured,
  loadDriveEntries,
  loadDriveSession,
  openGooglePicker,
  preloadGoogleIdentity,
  publishDriveToken,
  saveDriveSession,
  signInWithGoogle,
  signOutGoogle,
  tokenForRead,
} from "./drive.js?v=7";
import { parseEpub, spineCfi, spineIndexFromCfi } from "./epub.js?v=7";
import {
  LINK_MISSING_MESSAGE,
  createDeepLinkSession,
  findLinkedBook,
  parseDeepLink,
  spineIndexForDeepLink,
} from "./link.js?v=7";
import {
  ALIGNMENT_LABELS,
  alignmentKind,
  audioIndexForText,
  formatTime,
  loadOffset,
  offsetToAlign,
  saveOffset,
  textChapters,
  textIndexForAudio,
} from "./listen.js?v=7";
import { Reader } from "./reader.js?v=7";
import {
  closeBook,
  findShelfBook,
  initShelf,
  setShelfBooks,
  setSpreadStatus,
  shelfSource,
} from "./shelf.js?v=7";
import { getCachedEbook, putCachedEbook } from "./store.js?v=7";

const APP_VERSION = new URL(import.meta.url).searchParams.get("v") || "";
const LIBRARY_KEY = "libraryread.library.v1";
const SW_CHECK_MS = 60_000;

const $ = (id) => document.getElementById(id);
const els = {
  google: $("btn-google"),
  reauth: $("btn-reauth"),
  openLink: $("btn-open-link"),
  linkBanner: $("link-banner"),
  linkText: $("link-banner-text"),
  readerReauth: $("reader-reauth"),
  reload: $("btn-reload"),
  signout: $("btn-signout"),
  status: $("drive-status"),
  reader: $("reader"),
  readerBook: $("reader-book"),
  readerTitle: $("reader-title"),
  where: $("reader-where"),
  pageno: $("reader-pageno"),
  progressBar: $("reader-progress-bar"),
  listenBar: $("listen-bar"),
  listenTrack: $("listen-track"),
  listenTime: $("listen-time"),
  listenPlay: $("listen-play"),
  listenFollow: $("listen-follow"),
  listenProgress: $("listen-progress-bar"),
  tocList: $("toc-list"),
  tracksList: $("tracks-list"),
  alignHint: $("align-hint"),
  audio: $("audio"),
  toast: $("toast"),
};

const DEMO_BOOK = {
  id: "demo/flip",
  collectionId: "demo",
  collectionTitle: "示範",
  folder: "flip",
  title: "翻頁試讀",
  subtitle: null,
  author: "Library Read",
  chapters: [],
  ebook: { id: "demo.epub", name: "demo.epub", url: "./sample/demo.epub?v=7" },
  demo: true,
};

const session = {
  book: null,
  epub: null,
  listen: false,
  trackIndex: 0,
  offset: 0,
  saveTimer: 0,
  lastAudioSave: 0,
};

let swReloading = false;
let toastTimer = 0;
let libraryBooks = [];
let libraryReady = false;
/** @type {ReturnType<typeof createDeepLinkSession> | null} */
let linkSession = null;

function showToast(message, ms = 2600) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), ms);
}

const DRIVE_MESSAGES_ZH = {
  [DRIVE_ERROR_KIND.testUser]: "這個 Google 帳號還不是測試使用者。請 Jeff 在 OAuth 同意畫面加入這個帳號。",
  [DRIVE_ERROR_KIND.expired]: "Google 登入已過期，請再按一次「用 Google 登入」。",
  [DRIVE_ERROR_KIND.noLibrary]: "這個帳號看不到名為 Library 的資料夾。請 Jeff 把 Library 分享（檢視者）給這個帳號。",
  [DRIVE_ERROR_KIND.accessDenied]: "Google 沒有授權讀取 Drive。請用 Jeff 分享過 Library 的帳號登入。",
  [DRIVE_ERROR_KIND.config]: "還沒有設定 Google 登入（docs/drive.js 的 Client ID）。",
  [DRIVE_ERROR_KIND.reauth]: "需要重新授權才能讀 Google Drive。請按「重新授權」。",
};

function driveMessage(err) {
  const c = classifyDriveError(err);
  if (c.silent) return "";
  return DRIVE_MESSAGES_ZH[c.kind] || `無法打開 Google Drive：${c.message}`;
}

/* ---------- library snapshot ---------- */

function snapshotBook(book) {
  return {
    id: book.id,
    collectionId: book.collectionId,
    collectionTitle: book.collectionTitle,
    folder: book.folder,
    title: book.title,
    subtitle: book.subtitle || null,
    author: book.author,
    seriesFolder: book.seriesFolder || "",
    source: "drive",
    ebook: book.ebook
      ? {
          id: book.ebook.id,
          name: book.ebook.name,
          driveId: book.ebook.driveId || book.ebook.file?.driveId || null,
          size: book.ebook.size || book.ebook.file?.size || 0,
        }
      : null,
    chapters: (book.chapters || []).map((ch) => ({
      id: ch.id,
      title: ch.title,
      driveId: ch.driveId || ch.file?.driveId || null,
      size: ch.size || ch.file?.size || 0,
      type: ch.type || ch.file?.type || "",
    })),
  };
}

function saveLibrarySnapshot(books) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(books.map(snapshotBook)));
  } catch {
    /* quota / private mode */
  }
}

function loadLibrarySnapshot() {
  try {
    const rows = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter((b) => b && b.id) : [];
  } catch {
    return [];
  }
}

/* ---------- Drive ---------- */

function updateDriveChrome() {
  const signedIn = !!getAccessToken();
  const saved = loadDriveSession();
  els.google.classList.toggle("hidden", signedIn);
  els.reload.classList.toggle("hidden", !signedIn);
  els.signout.classList.toggle("hidden", !signedIn && !saved);
  if (els.openLink && linkSession?.hasTarget()) els.openLink.textContent = linkSession.buttonLabel();
  if (signedIn) {
    els.status.textContent = `已連上 Google Drive${saved?.email ? `（${saved.email}）` : ""}。`;
  } else if (saved) {
    els.status.textContent = `上次讀的是 ${saved.folderName || "Library"}${saved.email ? `（${saved.email}）` : ""}。要讀新的書或聽音檔，請再用 Google 登入。`;
  } else if (!isGoogleClientConfigured()) {
    els.status.textContent = "Google 登入尚未設定。";
  } else {
    els.status.textContent = "示範書可以直接翻。登入後顯示 Drive 上 Library 的書。";
  }
}

function showReauth() {
  els.reauth?.classList.remove("hidden");
  if (els.reauth) els.reauth.hidden = false;
  els.readerReauth?.classList.remove("hidden");
  if (els.readerReauth) els.readerReauth.hidden = false;
}

function hideReauth() {
  els.reauth?.classList.add("hidden");
  if (els.reauth) els.reauth.hidden = true;
  els.readerReauth?.classList.add("hidden");
  if (els.readerReauth) els.readerReauth.hidden = true;
}

function showLinkBanner() {
  const link = linkSession?.target();
  if (!link || !els.linkBanner) return;
  els.linkText.textContent = `要打開《${link.book}》（${link.series}）`;
  els.openLink.textContent = linkSession.buttonLabel();
  els.linkBanner.classList.remove("hidden");
  els.linkBanner.hidden = false;
}

function hideLinkBanner() {
  els.linkBanner?.classList.add("hidden");
  if (els.linkBanner) els.linkBanner.hidden = true;
}

/**
 * Popup sign-in. Call from a click handler so requestAccessToken runs in that turn.
 * Later reads use tokenForRead (prompt: '') and never this.
 */
function startSignIn(after) {
  let pending = null;
  try {
    if (globalThis.google?.accounts?.oauth2?.initTokenClient) pending = beginInteractiveSignIn();
  } catch (err) {
    const msg = driveMessage(err) || "請再按一次「用 Google 登入」。";
    els.status.textContent = msg;
    showToast(msg, 4200);
    return;
  }
  const run = pending || signInWithGoogle({ prompt: "consent" });
  run
    .then(async (token) => {
      await publishDriveToken(token);
      hideReauth();
      updateDriveChrome();
      if (after) await after();
    })
    .catch((err) => {
      if (err?.quiet) return;
      const msg = driveMessage(err);
      if (err?.reauth) showReauth();
      if (msg) {
        els.status.textContent = msg;
        showToast(msg, 4200);
      }
    });
}

/** Reuse a fresh token, or refresh silently. Never opens a popup. */
async function ensureToken() {
  try {
    const token = await tokenForRead();
    await publishDriveToken(token);
    hideReauth();
    updateDriveChrome();
    return token;
  } catch (err) {
    if (err?.reauth) showReauth();
    throw err;
  }
}

async function loadFromDrive({ fresh = false } = {}) {
  const token = await ensureToken();
  els.status.textContent = "正在讀取 Library…";
  const saved = fresh ? null : loadDriveSession();
  const walked = await loadDriveEntries({
    token,
    folderId: saved?.folderId,
    folderName: saved?.folderName,
    pickWithPicker: isPickerConfigured() ? () => openGooglePicker(token) : undefined,
  });
  const books = buildLibrary(walked.entries).map((book) => ({
    ...book,
    source: "drive",
    ebook: book.ebook ? { ...book.ebook, driveId: book.ebook.file?.driveId, size: book.ebook.file?.size } : null,
    chapters: book.chapters.map((ch) => ({ ...ch, driveId: ch.file?.driveId, size: ch.file?.size })),
  }));
  const email = (await fetchDriveUser(token)) || saved?.email || "";
  saveDriveSession({ folderId: walked.folder.id, folderName: walked.folder.name, email });
  if (!books.length) {
    updateDriveChrome();
    els.status.textContent = "Library 裡沒有找到 ebooks/ 或 listen/ 的書。";
    return;
  }
  saveLibrarySnapshot(books);
  libraryBooks = books.map(snapshotBook);
  libraryReady = true;
  setShelfBooks(libraryBooks, "library");
  updateDriveChrome();
  const readable = books.filter(bookHasEbook).length;
  els.status.textContent += ` 共 ${books.length} 本，${readable} 本可以讀。`;
}

function runDriveLoad(opts) {
  loadFromDrive(opts).catch((err) => {
    updateDriveChrome();
    const msg = driveMessage(err);
    if (msg) {
      els.status.textContent = msg;
      showToast(msg, 4200);
    }
  });
}

/* ---------- open a book ---------- */

function progressLine(book) {
  const text = textProgress(book.id);
  if (!text) return bookHasEbook(book) ? "尚未開始" : "這本書沒有電子書，只有音訊。";
  return `讀到：${text.label || "閱讀中"}`;
}

/** Start a silent token fetch in this turn (the tap), before any await. Never a popup. */
function warmDriveToken(book) {
  if (!book || book.demo || book.ebook?.url || !book.ebook?.driveId) return null;
  if (freshAccessToken()) return Promise.resolve(freshAccessToken());
  return tokenForRead();
}

async function fetchDriveEbook(id, tokenPromise) {
  const pull = async (token) => {
    await publishDriveToken(token);
    return downloadDriveBuffer(id, token);
  };
  try {
    return await pull(await tokenPromise);
  } catch (err) {
    if (err?.reauth) {
      showReauth();
      throw err;
    }
    if (classifyDriveError(err).kind !== DRIVE_ERROR_KIND.expired) throw err;
    clearAccessToken();
    try {
      return await pull(await tokenForRead());
    } catch (err2) {
      if (err2?.reauth) showReauth();
      throw err2;
    }
  }
}

async function ebookBytes(book, warm) {
  if (book.ebook?.url) {
    const res = await fetch(book.ebook.url);
    if (!res.ok) throw new Error(`demo ${res.status}`);
    return res.arrayBuffer();
  }
  const id = book.ebook?.driveId;
  if (!id) throw new Error("這本書沒有電子書。");
  const cached = await getCachedEbook(id);
  if (cached) return cached;
  const bytes = await fetchDriveEbook(id, warm || tokenForRead());
  putCachedEbook(id, bytes, { bookId: book.id, name: book.ebook.name });
  return bytes;
}

function trackUrl(ch) {
  if (ch.url) return ch.url;
  if (ch.driveId) return driveMediaUrl(ch.driveId);
  return "";
}

function readerStart(epub, deepLink) {
  if (deepLink) {
    const spine = spineIndexForDeepLink(textChapters(epub.spine), deepLink.chapter);
    if (deepLink.chapter != null && spine == null) showToast("沒有這個章節，從開頭讀。");
    return { spineIndex: spine ?? firstTextSpine(epub), fraction: 0 };
  }
  const saved = session.book ? textProgress(session.book.id) : null;
  return {
    spineIndex: saved ? spineIndexFromCfi(saved.locator) : firstTextSpine(epub),
    fraction: saved?.fraction || 0,
  };
}

async function openReader(book, { listen, deepLink = null } = {}) {
  const shelfBook = findShelfBook(book.id) || book;
  const warm = warmDriveToken(shelfBook);
  const wantsAudio = listen && bookHasAudio(shelfBook);
  session.book = shelfBook;
  session.listen = wantsAudio;
  session.offset = loadOffset(shelfBook.id);
  const heardBefore = !!loadProgress()[shelfBook.id]?.chapterId;
  if (wantsAudio) {
    const saved = loadProgress()[shelfBook.id];
    const idx = Math.max(0, shelfBook.chapters.findIndex((c) => c.id === saved?.chapterId));
    // Start audio inside the tap: iOS drops the gesture after any await.
    if (getAccessToken() || !shelfBook.chapters[idx]?.driveId) loadTrack(idx, { play: true });
    else loadTrack(idx, { play: false });
  } else {
    stopAudio();
  }
  setSpreadStatus("正在打開…");
  let bytes;
  try {
    bytes = await ebookBytes(shelfBook, warm);
  } catch (err) {
    const msg = driveMessage(err) || "打不開這本電子書。";
    setSpreadStatus(msg);
    showToast(msg, 4200);
    stopAudio();
    return false;
  }
  let epub;
  try {
    epub = await parseEpub(bytes);
  } catch (err) {
    setSpreadStatus(`這個 EPUB 讀不出來：${err.message}`);
    stopAudio();
    return false;
  }
  session.epub = epub;
  showReaderScreen(shelfBook);
  reader.open(epub, readerStart(epub, deepLink));
  if (deepLink) hideLinkBanner();
  renderToc();
  const saved = textProgress(shelfBook.id);
  if (wantsAudio) {
    if (saved && !heardBefore) {
      // Read before but never listened: start the track that matches the page.
      const idx = trackForCurrentText();
      if (idx !== session.trackIndex) loadTrack(idx, { play: !els.audio.paused, start: 0 });
    } else {
      followAudio({ force: !saved });
    }
    renderTracks();
    showListenBar(true);
    if (!getAccessToken() && shelfBook.chapters[session.trackIndex]?.driveId) {
      showToast("按 ▶ 開始聽（需要 Google 登入）。", 3200);
    }
  } else {
    showListenBar(false);
  }
  closeBook();
  return true;
}

function firstTextSpine(epub) {
  const titled = epub.spine.find((s) => s.title);
  return titled ? titled.index : 0;
}

function showReaderScreen(book) {
  els.readerTitle.textContent = book.title;
  els.reader.classList.remove("hidden");
  els.reader.hidden = false;
  document.documentElement.classList.add("reading");
  els.reader.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
}

function closeReader() {
  persistText();
  persistAudio();
  stopAudio();
  reader.close();
  session.book = null;
  session.epub = null;
  els.reader.classList.add("hidden");
  els.reader.hidden = true;
  document.documentElement.classList.remove("reading");
  hideSheets();
}

/* ---------- reader chrome ---------- */

function onReaderChange(pos) {
  if (!session.book) return;
  els.where.textContent = pos.chapterTitle || "";
  const shown = pos.spread && pos.page + 1 < pos.pages ? `${pos.page + 1}–${pos.page + 2}` : `${pos.page + 1}`;
  els.pageno.textContent = `${shown} / ${pos.pages}`;
  const overall = pos.spineCount > 0 ? (pos.spineIndex + pos.fraction) / pos.spineCount : 0;
  els.progressBar.style.transform = `scaleX(${Math.min(1, Math.max(0, overall))})`;
  for (const li of els.tocList.querySelectorAll("li")) {
    li.classList.toggle("is-current", Number(li.dataset.text) === pos.textIndex);
  }
  clearTimeout(session.saveTimer);
  session.saveTimer = setTimeout(() => persistText(), 400);
}

function persistText() {
  if (!session.book || !session.epub) return;
  clearTimeout(session.saveTimer);
  const pos = reader.position();
  saveTextProgress(session.book.id, {
    kind: "epub-cfi",
    locator: spineCfi(pos.spineIndex),
    fraction: pos.fraction,
    label: pos.chapterTitle,
  });
}

function renderToc() {
  els.tocList.innerHTML = "";
  const current = reader.position().textIndex;
  for (const ch of reader.chapters) {
    const li = document.createElement("li");
    li.dataset.text = String(ch.index);
    li.classList.toggle("is-current", ch.index === current);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = ch.title;
    btn.addEventListener("click", () => {
      hideSheets();
      reader.goTo(ch.spineIndex);
    });
    li.appendChild(btn);
    els.tocList.appendChild(li);
  }
}

function openSheet(id) {
  const sheet = $(id);
  sheet.classList.remove("hidden");
  sheet.hidden = false;
}

function hideSheets() {
  for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.classList.add("hidden");
    sheet.hidden = true;
  }
}

/* ---------- listen-along ---------- */

function tracks() {
  return session.book?.chapters || [];
}

function loadTrack(index, { play = false, start = null } = {}) {
  const list = tracks();
  const ch = list[index];
  if (!ch) return;
  session.trackIndex = index;
  const audio = els.audio;
  const url = trackUrl(ch);
  const resume = start ?? resumeSeconds(chapterProgress(session.book.id, ch.id));
  if (audio.dataset.track !== `${session.book.id}::${ch.id}`) {
    audio.dataset.track = `${session.book.id}::${ch.id}`;
    audio.src = url;
    audio.dataset.resume = String(resume || 0);
  } else if (start != null) {
    audio.currentTime = start;
  }
  if (play) {
    const p = audio.play();
    if (p?.catch) p.catch(() => updatePlayButton());
  }
  updateTrackChrome();
  updateMediaSession();
}

function stopAudio() {
  const audio = els.audio;
  audio.pause();
  audio.removeAttribute("src");
  delete audio.dataset.track;
  audio.load();
  updatePlayButton();
}

function persistAudio() {
  if (!session.listen || !session.book) return;
  const ch = tracks()[session.trackIndex];
  const audio = els.audio;
  if (!ch || !audio.src) return;
  if (!Number.isFinite(audio.currentTime) || audio.currentTime <= 0) return;
  saveProgress(session.book.id, ch.id, audio.currentTime, audio.duration);
}

function showListenBar(on) {
  els.listenBar.classList.toggle("hidden", !on);
  els.listenBar.hidden = !on;
  els.reader.classList.toggle("is-listening", on);
  reader.scheduleRelayout();
  updateTrackChrome();
}

function updatePlayButton() {
  const playing = !els.audio.paused && !els.audio.ended;
  els.listenPlay.classList.toggle("is-paused", !playing);
  els.listenPlay.setAttribute("aria-label", playing ? "暫停" : "播放");
}

function updateTrackChrome() {
  const list = tracks();
  const ch = list[session.trackIndex];
  if (!ch) return;
  els.listenTrack.textContent = `音訊 ${session.trackIndex + 1}/${list.length} · ${ch.title}`;
  for (const li of els.tracksList.querySelectorAll("li")) {
    li.classList.toggle("is-current", Number(li.dataset.track) === session.trackIndex);
  }
  updatePlayButton();
}

function renderTracks() {
  els.tracksList.innerHTML = "";
  const list = tracks();
  const kind = alignmentKind(reader.chapters, list);
  els.alignHint.textContent = [ALIGNMENT_LABELS[kind], session.offset ? `已手動調整 ${session.offset > 0 ? "+" : ""}${session.offset} 章` : ""]
    .filter(Boolean)
    .join(" · ");
  list.forEach((ch, i) => {
    const li = document.createElement("li");
    li.dataset.track = String(i);
    const btn = document.createElement("button");
    btn.type = "button";
    const target = reader.chapters[textIndexForAudio(reader.chapters, list, i, session.offset)];
    btn.innerHTML = `<strong></strong><span></span>`;
    btn.querySelector("strong").textContent = ch.title;
    btn.querySelector("span").textContent = target ? `→ ${target.title}` : "";
    btn.addEventListener("click", () => {
      hideSheets();
      persistAudio();
      loadTrack(i, { play: true });
      followAudio({ force: true });
    });
    li.appendChild(btn);
    els.tracksList.appendChild(li);
  });
  updateTrackChrome();
}

/** Move the text to the chapter that matches the playing track. */
function followAudio({ force = false } = {}) {
  if (!session.listen || !session.epub) return;
  if (!force && !els.listenFollow.checked) return;
  const textIdx = textIndexForAudio(reader.chapters, tracks(), session.trackIndex, session.offset);
  const target = reader.chapters[textIdx];
  if (!target) return;
  if (reader.position().textIndex === textIdx) return;
  reader.goTo(target.spineIndex);
}

function alignHere() {
  const pos = reader.position();
  session.offset = offsetToAlign(reader.chapters, tracks(), session.trackIndex, pos.textIndex);
  saveOffset(session.book.id, session.offset);
  renderTracks();
  showToast(`已對齊：${tracks()[session.trackIndex]?.title} ↔ ${pos.chapterTitle}`);
}

function trackForCurrentText() {
  return audioIndexForText(reader.chapters, tracks(), reader.position().textIndex, session.offset);
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !session.book) return;
  const ch = tracks()[session.trackIndex];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ch?.title || session.book.title,
      artist: session.book.author || "",
      album: session.book.title,
    });
  } catch {
    /* MediaMetadata unsupported */
  }
}

function bindAudio() {
  const audio = els.audio;
  audio.addEventListener("loadedmetadata", () => {
    const resume = Number(audio.dataset.resume || 0);
    delete audio.dataset.resume;
    if (resume > 0 && resume < (audio.duration || Infinity) - 1) audio.currentTime = resume;
  });
  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", () => {
    updatePlayButton();
    persistAudio();
  });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration;
    els.listenTime.textContent = Number.isFinite(d) ? `${formatTime(audio.currentTime)} / ${formatTime(d)}` : formatTime(audio.currentTime);
    els.listenProgress.style.transform = `scaleX(${d > 0 ? Math.min(1, audio.currentTime / d) : 0})`;
    const now = Date.now();
    if (now - session.lastAudioSave > 5000) {
      session.lastAudioSave = now;
      persistAudio();
    }
  });
  audio.addEventListener("ended", () => {
    if (!session.listen || !session.book) return;
    const ch = tracks()[session.trackIndex];
    if (ch) saveProgress(session.book.id, ch.id, 0, audio.duration);
    const next = session.trackIndex + 1;
    if (next >= tracks().length) {
      showToast("這本書的音訊播完了。");
      updatePlayButton();
      return;
    }
    loadTrack(next, { play: true, start: 0 });
    followAudio();
    showToast(`下一段：${tracks()[next].title}`);
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    const needsLogin = !getAccessToken() && tracks()[session.trackIndex]?.driveId;
    showToast(needsLogin ? "要聽 Drive 上的音檔，請先用 Google 登入。" : "這段音訊播不出來。", 3600);
    updatePlayButton();
  });

  els.listenPlay.addEventListener("click", () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    const ch = tracks()[session.trackIndex];
    if (ch?.driveId && !freshAccessToken()) {
      tokenForRead()
        .then((token) => publishDriveToken(token))
        .then(() => {
          hideReauth();
          audio.load();
          return audio.play();
        })
        .catch((err) => {
          if (err?.reauth) showReauth();
          showToast(driveMessage(err) || "沒有開始播放。");
        });
      return;
    }
    if (!audio.getAttribute("src")) loadTrack(session.trackIndex);
    audio.play().catch(() => updatePlayButton());
  });
  $("listen-back30").addEventListener("click", () => {
    audio.currentTime = Math.max(0, audio.currentTime - 30);
  });
  $("listen-fwd30").addEventListener("click", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration - 0.25, audio.currentTime + 30);
  });
  $("listen-prev").addEventListener("click", () => {
    persistAudio();
    if (audio.currentTime > 5 || session.trackIndex === 0) {
      audio.currentTime = 0;
      return;
    }
    loadTrack(session.trackIndex - 1, { play: !audio.paused, start: 0 });
    followAudio();
  });
  $("listen-next").addEventListener("click", () => {
    if (session.trackIndex + 1 >= tracks().length) return;
    persistAudio();
    loadTrack(session.trackIndex + 1, { play: !audio.paused, start: 0 });
    followAudio();
  });
  $("listen-tracks").addEventListener("click", () => {
    renderTracks();
    openSheet("tracks-sheet");
  });
  $("btn-goto-playing").addEventListener("click", () => {
    hideSheets();
    followAudio({ force: true });
  });
  $("btn-align").addEventListener("click", () => {
    hideSheets();
    alignHere();
  });

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => audio.play());
    set("pause", () => audio.pause());
    set("seekbackward", () => (audio.currentTime = Math.max(0, audio.currentTime - 30)));
    set("seekforward", () => (audio.currentTime = audio.currentTime + 30));
    set("previoustrack", () => $("listen-prev").click());
    set("nexttrack", () => $("listen-next").click());
  }
}

/* ---------- service worker ---------- */

function reloadWhenIdle() {
  const audio = els.audio;
  if (!audio.paused && !audio.ended) {
    audio.addEventListener("pause", () => location.reload(), { once: true });
    return;
  }
  persistText();
  location.reload();
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastCheck = 0;
  const checkForUpdate = () => {
    const now = Date.now();
    if (now - lastCheck < SW_CHECK_MS) return;
    lastCheck = now;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  };
  navigator.serviceWorker
    .register(new URL("./sw.js", import.meta.url).href)
    .then((reg) => {
      lastCheck = Date.now();
      return reg.update();
    })
    .catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  addEventListener("pageshow", (e) => {
    if (e.persisted) checkForUpdate();
  });
  addEventListener("focus", checkForUpdate);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (getAccessToken()) publishDriveToken(getAccessToken());
    if (!hadController || swReloading) return;
    swReloading = true;
    reloadWhenIdle();
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== DRIVE_UNAUTHORIZED_MESSAGE) return;
    clearAccessToken();
    tokenForRead()
      .then((token) => publishDriveToken(token))
      .then(() => hideReauth())
      .catch((err) => {
        if (err?.reauth) showReauth();
        showToast(DRIVE_MESSAGES_ZH[DRIVE_ERROR_KIND.reauth], 4200);
      });
  });
}

/* ---------- boot ---------- */

const reader = new Reader(els.readerBook, {
  onChange: onReaderChange,
  onEdge(dir) {
    if (dir > 0) showToast("已經是最後一頁。");
  },
});

function handleLinkResult(result) {
  if (!result || result.status === "idle" || result.status === "opened") {
    if (result?.status === "opened") hideLinkBanner();
    return;
  }
  if (result.status === "missing") {
    hideLinkBanner();
    if (session.book) closeReader();
    closeBook();
    els.status.textContent = result.message || LINK_MISSING_MESSAGE;
    showToast(result.message || LINK_MISSING_MESSAGE, 4200);
  }
}

function onReauthClick() {
  const retryLink = !!linkSession?.hasTarget();
  const retryBook = session.book && !session.epub ? session.book : null;
  const retryListen = session.listen;
  startSignIn(async () => {
    showToast("已重新授權。", 1800);
    if (retryLink) handleLinkResult(await linkSession.activate());
    else if (retryBook) await openReader(retryBook, { listen: retryListen });
  });
}

function bind() {
  els.google.addEventListener("click", () => {
    const openAfter = !!linkSession?.hasTarget();
    startSignIn(async () => {
      await loadFromDrive();
      if (openAfter) handleLinkResult(await linkSession.activate());
    });
  });
  els.reauth?.addEventListener("click", onReauthClick);
  els.readerReauth?.addEventListener("click", onReauthClick);
  els.openLink?.addEventListener("click", () => {
    linkSession
      ?.activate()
      .then(handleLinkResult)
      .catch((err) => {
        if (err?.quiet) return;
        if (err?.reauth) showReauth();
        const msg = driveMessage(err);
        if (msg) {
          els.status.textContent = msg;
          showToast(msg, 4200);
        }
      });
  });
  els.reload.addEventListener("click", () => runDriveLoad());
  els.signout.addEventListener("click", async () => {
    await signOutGoogle();
    await publishDriveToken("");
    clearDriveSession();
    localStorage.removeItem(LIBRARY_KEY);
    libraryBooks = [];
    libraryReady = false;
    hideReauth();
    setShelfBooks([DEMO_BOOK], "demo");
    updateDriveChrome();
  });
  $("reader-back").addEventListener("click", closeReader);
  $("reader-toc").addEventListener("click", () => {
    renderToc();
    openSheet("toc-sheet");
  });
  $("reader-font").addEventListener("click", () => {
    const step = reader.cycleFont();
    showToast(`字級 ${step + 1}/4`, 1200);
  });
  for (const btn of document.querySelectorAll("[data-close]")) {
    btn.addEventListener("click", hideSheets);
  }
  for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) hideSheets();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (els.reader.hidden) return;
    if (e.target?.closest?.("input, textarea")) return;
    if (e.key === "Escape") {
      if (document.querySelector(".sheet:not([hidden])")) hideSheets();
      else closeReader();
    } else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
      e.preventDefault();
      reader.next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
      e.preventDefault();
      reader.prev();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistText();
      persistAudio();
    }
  });
}

function boot() {
  const versionEl = $("app-version");
  if (versionEl && APP_VERSION) versionEl.textContent = `v${APP_VERSION}`;
  initShelf({
    onRead: (book, opts) => openReader(book, opts),
    progressLine,
  });
  const snapshot = loadLibrarySnapshot();
  if (snapshot.length) {
    libraryBooks = snapshot;
    setShelfBooks(snapshot, "library");
  } else setShelfBooks([DEMO_BOOK], "demo");
  linkSession = createDeepLinkSession({
    isSignedIn: () => !!freshAccessToken(),
    beginInteractiveSignIn,
    ensureLibrary: async () => {
      if (libraryReady && freshAccessToken()) return;
      await loadFromDrive();
    },
    findBook: (link) => findLinkedBook(libraryBooks, link),
    openBook: async (book, { chapter } = {}) => {
      const ok = await openReader(book, { listen: false, deepLink: { chapter } });
      if (!ok) {
        const err = new Error("打不開這本電子書。");
        err.quiet = true;
        throw err;
      }
    },
  });
  const link = parseDeepLink(location.search);
  if (link) {
    linkSession.load(link);
    showLinkBanner();
  }
  bind();
  bindAudio();
  updateDriveChrome();
  registerSW();
  if (isGoogleClientConfigured()) {
    els.google.disabled = true;
    if (els.openLink) els.openLink.disabled = true;
    preloadGoogleIdentity()
      .then(() => {
        els.google.disabled = false;
        if (els.openLink) els.openLink.disabled = false;
      })
      .catch(() => {
        els.google.disabled = false;
        if (els.openLink) els.openLink.disabled = false;
      });
  }
  document.documentElement.dataset.ready = shelfSource();
}

boot();
