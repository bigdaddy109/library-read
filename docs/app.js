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
} from "./library.js?v=2";
import {
  DRIVE_ERROR_KIND,
  DRIVE_UNAUTHORIZED_MESSAGE,
  classifyDriveError,
  clearDriveSession,
  downloadDriveBuffer,
  driveMediaUrl,
  fetchDriveUser,
  getAccessToken,
  isGoogleClientConfigured,
  isPickerConfigured,
  loadDriveEntries,
  loadDriveSession,
  openGooglePicker,
  publishDriveToken,
  saveDriveSession,
  signInWithGoogle,
  signOutGoogle,
} from "./drive.js?v=2";
import { parseEpub, spineCfi, spineIndexFromCfi } from "./epub.js?v=2";
import {
  ALIGNMENT_LABELS,
  alignmentKind,
  audioIndexForText,
  formatTime,
  loadOffset,
  offsetToAlign,
  saveOffset,
  textIndexForAudio,
} from "./listen.js?v=2";
import { Reader } from "./reader.js?v=2";
import {
  closeBook,
  findShelfBook,
  initShelf,
  setShelfBooks,
  setSpreadStatus,
  shelfSource,
} from "./shelf.js?v=2";
import { getCachedEbook, putCachedEbook } from "./store.js?v=2";

const APP_VERSION = new URL(import.meta.url).searchParams.get("v") || "";
const LIBRARY_KEY = "libraryread.library.v1";
const SW_CHECK_MS = 60_000;

const $ = (id) => document.getElementById(id);
const els = {
  google: $("btn-google"),
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
  ebook: { id: "demo.epub", name: "demo.epub", url: "./sample/demo.epub?v=2" },
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

async function ensureToken() {
  const existing = getAccessToken();
  if (existing) return existing;
  const token = await signInWithGoogle();
  await publishDriveToken(token);
  updateDriveChrome();
  return token;
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
  setShelfBooks(books.map(snapshotBook), "library");
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

async function ebookBytes(book) {
  if (book.ebook?.url) {
    const res = await fetch(book.ebook.url);
    if (!res.ok) throw new Error(`demo ${res.status}`);
    return res.arrayBuffer();
  }
  const id = book.ebook?.driveId;
  if (!id) throw new Error("這本書沒有電子書。");
  const cached = await getCachedEbook(id);
  if (cached) return cached;
  const token = await ensureToken();
  const bytes = await downloadDriveBuffer(id, token);
  putCachedEbook(id, bytes, { bookId: book.id, name: book.ebook.name });
  return bytes;
}

function trackUrl(ch) {
  if (ch.url) return ch.url;
  if (ch.driveId) return driveMediaUrl(ch.driveId);
  return "";
}

async function openReader(book, { listen }) {
  const shelfBook = findShelfBook(book.id) || book;
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
    bytes = await ebookBytes(shelfBook);
  } catch (err) {
    const msg = driveMessage(err) || "打不開這本電子書。";
    setSpreadStatus(msg);
    showToast(msg, 4200);
    stopAudio();
    return;
  }
  let epub;
  try {
    epub = await parseEpub(bytes);
  } catch (err) {
    setSpreadStatus(`這個 EPUB 讀不出來：${err.message}`);
    stopAudio();
    return;
  }
  session.epub = epub;
  showReaderScreen(shelfBook);
  const saved = textProgress(shelfBook.id);
  reader.open(epub, {
    spineIndex: saved ? spineIndexFromCfi(saved.locator) : firstTextSpine(epub),
    fraction: saved?.fraction || 0,
  });
  renderToc();
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
    if (ch?.driveId && !getAccessToken()) {
      ensureToken()
        .then(() => {
          audio.load();
          return audio.play();
        })
        .catch((err) => showToast(driveMessage(err) || "沒有開始播放。"));
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
    showToast(DRIVE_MESSAGES_ZH[DRIVE_ERROR_KIND.expired], 4200);
  });
}

/* ---------- boot ---------- */

const reader = new Reader(els.readerBook, {
  onChange: onReaderChange,
  onEdge(dir) {
    if (dir > 0) showToast("已經是最後一頁。");
  },
});

function bind() {
  els.google.addEventListener("click", () => runDriveLoad());
  els.reload.addEventListener("click", () => runDriveLoad());
  els.signout.addEventListener("click", async () => {
    await signOutGoogle();
    await publishDriveToken("");
    clearDriveSession();
    localStorage.removeItem(LIBRARY_KEY);
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
  if (snapshot.length) setShelfBooks(snapshot, "library");
  else setShelfBooks([DEMO_BOOK], "demo");
  bind();
  bindAudio();
  updateDriveChrome();
  registerSW();
  document.documentElement.dataset.ready = shelfSource();
}

boot();
