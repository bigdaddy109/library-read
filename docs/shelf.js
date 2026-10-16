/**
 * 封面牆 + the open-book motion, ported from Library Listen's shelf.js:
 * tap a cover → it zooms onto the closed book → the front board hinges open
 * to the left → inner page with 讀 / 邊聽邊讀.
 */
import {
  COVER_MORPH,
  bookFlipFrames,
  coverMorphTransform,
  emptyShelfMessage,
  filterShelf,
  mediaFlags,
  readOrder,
  seriesChips,
  seriesIdForBook,
  seriesMeta,
  shelfStatusLabel,
} from "./catalog.js?v=5";
import { coverSvg } from "./covers.js?v=5";
import { trimQuery } from "./search.js?v=5";

const SERIES_KEY = "libraryread.shelfSeries";

const state = {
  books: [],
  source: "demo",
  query: "",
  seriesId: "all",
  selectedId: null,
  morphing: false,
};

let els = {};
let hooks = { onRead: null, progressLine: null };

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function visibleBooks() {
  return readOrder(filterShelf(state.books, { query: state.query, seriesId: state.seriesId }));
}

export function findShelfBook(id) {
  return state.books.find((b) => b.id === id) || null;
}

function renderChips() {
  els.chips.innerHTML = "";
  const chips = seriesChips(state.books);
  if (!chips.some((c) => c.id === state.seriesId)) state.seriesId = "all";
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.series = chip.id;
    btn.setAttribute("aria-pressed", chip.id === state.seriesId ? "true" : "false");
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.style.background = chip.accent;
    btn.append(dot, document.createTextNode(`${chip.title} ${chip.count}`));
    btn.addEventListener("click", () => {
      state.seriesId = chip.id;
      try {
        localStorage.setItem(SERIES_KEY, chip.id);
      } catch {
        /* private mode */
      }
      render();
    });
    els.chips.appendChild(btn);
  }
}

function renderCovers(books) {
  const grid = document.createElement("div");
  grid.className = "covers";
  for (const book of books) {
    const flags = mediaFlags(book);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "cover-card";
    card.dataset.id = book.id;
    if (!flags.read) card.classList.add("is-audio-only");
    card.setAttribute("aria-label", `${book.title} · ${flags.badge}`);
    card.innerHTML = `<span class="cover-art"></span><h3></h3><p></p>`;
    card.querySelector(".cover-art").innerHTML = coverSvg(book);
    card.querySelector("h3").textContent = book.title;
    card.querySelector("p").textContent = `${book.author || ""} · ${flags.badge}`;
    card.addEventListener("click", () => openCoverBook(book));
    grid.appendChild(card);
  }
  els.stage.appendChild(grid);
}

export function renderShelf() {
  render();
}

function render() {
  renderChips();
  const books = visibleBooks();
  els.count.textContent = shelfStatusLabel(books.length, state.query, state.seriesId);
  els.clear?.classList.toggle("hidden", !trimQuery(state.query));
  els.stage.innerHTML = "";
  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "shelf-empty";
    empty.textContent = emptyShelfMessage(state.query, state.seriesId) || "書架是空的。";
    els.stage.appendChild(empty);
    return;
  }
  renderCovers(books);
}

export function setShelfBooks(books, source = "library") {
  const next = Array.isArray(books) ? books : [];
  const same =
    state.source === source &&
    state.books.length === next.length &&
    state.books.every((b, i) => b.id === next[i]?.id);
  state.books = next;
  state.source = source;
  if (!same && !state.morphing) closeBook();
  render();
}

export function shelfSource() {
  return state.source;
}

/* ---------- open-book motion (from Library Listen) ---------- */

function cardArtFor(bookId) {
  for (const el of els.stage.querySelectorAll(".cover-card")) {
    if (el.dataset.id === bookId) return el.querySelector(".cover-art svg");
  }
  return null;
}

function markDrawn(bookId, drawn) {
  for (const el of els.stage.querySelectorAll(".cover-card")) {
    el.classList.toggle("is-drawn", Boolean(drawn) && el.dataset.id === bookId);
  }
}

function spreadArt() {
  return els.bookStage.querySelector(".leaf-front svg");
}

function onScreen(rect) {
  return !!rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

function setMorphing(on) {
  state.morphing = on;
  if (on) els.layer.dataset.morph = "1";
  else delete els.layer.dataset.morph;
}

export function closeBook() {
  markDrawn(state.selectedId, false);
  state.selectedId = null;
  document.documentElement.classList.remove("book-open");
  els.layer.classList.add("hidden");
  els.layer.hidden = true;
  els.bookStage.innerHTML = "";
}

function showCoverSpread(book, { opened }) {
  state.selectedId = book.id;
  markDrawn(book.id, true);
  document.documentElement.classList.add("book-open");
  els.layer.classList.remove("hidden");
  els.layer.hidden = false;
  renderSpread(book, opened);
}

function flipBook(opening) {
  const root = els.bookStage.querySelector(".draw-root.is-cover");
  if (!root) return Promise.resolve();
  root.classList.toggle("is-opened", opening);
  root.classList.toggle("is-closed", !opening);
  const frames = bookFlipFrames(opening);
  const timing = {
    duration: opening ? COVER_MORPH.flipMs : COVER_MORPH.flipCloseMs,
    delay: opening ? COVER_MORPH.flipDelayMs : 0,
    easing: COVER_MORPH.flipEasing,
    fill: "backwards",
  };
  const parts = [
    [".cover-leaf", frames.leaf],
    [".spread", frames.spread],
    [".page.left", frames.endpaper],
    [".leaf-front", frames.front],
    [".leaf-back", frames.back],
    [".page.right .page-shade", frames.pageShade],
    [".leaf-front .leaf-shade", frames.frontShade],
    [".leaf-back .leaf-shade", frames.backShade],
  ];
  root.classList.add("is-flipping");
  const anims = parts.map(([sel, f]) => root.querySelector(sel)?.animate(f, timing)).filter(Boolean);
  return Promise.all(anims.map((a) => a.finished))
    .catch(() => {})
    .then(() => root.classList.remove("is-flipping"));
}

function flipMorph({ cardEl, opening }) {
  const art = spreadArt();
  if (!art) return Promise.resolve();
  const bigRect = art.getBoundingClientRect();
  const cardRect = cardEl && onScreen(cardEl.getBoundingClientRect()) ? cardEl.getBoundingClientRect() : null;
  const duration = opening ? COVER_MORPH.openMs : COVER_MORPH.closeMs;
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  const layerAnim = els.layer.animate(opening ? fade : [...fade].reverse(), {
    duration: opening ? duration * 0.7 : duration * 0.8,
    easing: "ease-out",
    fill: "both",
  });
  const shrunk = coverMorphTransform(cardRect, bigRect);
  if (!shrunk) return layerAnim.finished.catch(() => {}).then(() => layerAnim.cancel());
  const ghost = art.cloneNode(true);
  ghost.classList.add("cover-ghost");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    left: `${bigRect.left}px`,
    top: `${bigRect.top}px`,
    width: `${bigRect.width}px`,
    height: `${bigRect.height}px`,
  });
  document.body.appendChild(ghost);
  art.style.opacity = "0";
  const frames = [{ transform: shrunk.css }, { transform: "none" }];
  const ghostAnim = ghost.animate(opening ? frames : frames.reverse(), {
    duration,
    easing: COVER_MORPH.easing,
    fill: "both",
  });
  return Promise.all([ghostAnim.finished, layerAnim.finished])
    .catch(() => {})
    .then(() => {
      art.style.opacity = "";
      ghost.remove();
      layerAnim.cancel();
    });
}

export async function openCoverBook(book) {
  if (state.morphing) return;
  const fromEl = cardArtFor(book.id);
  if (prefersReducedMotion() || !fromEl) {
    showCoverSpread(book, { opened: true });
    return;
  }
  setMorphing(true);
  try {
    showCoverSpread(book, { opened: false });
    await flipMorph({ cardEl: fromEl, opening: true });
    await flipBook(true);
  } finally {
    setMorphing(false);
  }
}

export async function closeCoverBook() {
  if (state.morphing) return;
  const id = state.selectedId;
  if (prefersReducedMotion() || !spreadArt() || !id) {
    closeBook();
    return;
  }
  setMorphing(true);
  try {
    await flipBook(false);
    markDrawn(id, false);
    const cardEl = cardArtFor(id);
    if (cardEl) cardEl.style.opacity = "0";
    await flipMorph({ cardEl, opening: false });
    if (cardEl) cardEl.style.opacity = "";
    closeBook();
  } finally {
    setMorphing(false);
  }
}

export function setSpreadStatus(text) {
  const el = els.bookStage.querySelector(".progress");
  if (el) el.textContent = text;
}

function renderSpread(book, opened) {
  const series = seriesMeta(book);
  const flags = mediaFlags(book);
  const siblings = state.books.filter((b) => seriesIdForBook(b) === series.id);
  const volume = String(Math.max(1, siblings.findIndex((b) => b.id === book.id) + 1)).padStart(2, "0");
  const bookplate = `
    <div class="bookplate">
      <div class="bookplate-card">
        <div class="seal" style="--accent:${series.accent}">藏</div>
        <p>藏書票</p>
        <strong></strong>
        <p class="vol"></p>
      </div>
    </div>`;
  els.bookStage.innerHTML = `
    <div class="draw-root is-open is-cover ${opened ? "is-opened" : "is-closed"}">
      <article class="spread">
        <section class="page left"></section>
        <section class="page right"><span class="page-shade" aria-hidden="true"></span>
          <p class="kicker"></p>
          <h2></h2>
          <p class="author"></p>
          <p class="progress"></p>
          <div class="actions">
            <button type="button" class="primary" data-open="read">讀</button>
            <button type="button" class="primary" data-open="listen">邊聽邊讀</button>
          </div>
        </section>
        <div class="cover-leaf" aria-hidden="true">
          <div class="leaf-face leaf-front" style="--paper:${series.paper}">
            ${coverSvg(book, { width: 240, height: 330 })}
            <span class="leaf-shade"></span>
          </div>
          <div class="leaf-face leaf-back">${bookplate}<span class="leaf-shade"></span></div>
        </div>
      </article>
    </div>`;
  const root = els.bookStage.querySelector(".draw-root");
  root.style.setProperty("--cloth", series.cloth);
  root.style.setProperty("--accent", series.accent);
  els.bookStage.querySelector(".bookplate-card strong").textContent = series.title;
  els.bookStage.querySelector(".vol").textContent = `編號 ${volume}`;
  els.bookStage.querySelector(".kicker").textContent = `${series.title} · ${flags.badge}`;
  els.bookStage.querySelector("h2").textContent = book.title;
  els.bookStage.querySelector(".author").textContent = book.author || "";
  els.bookStage.querySelector(".progress").textContent =
    hooks.progressLine?.(book) || (flags.read ? "尚未開始" : "這本書沒有電子書，只有音訊。");
  const read = els.bookStage.querySelector('[data-open="read"]');
  const listen = els.bookStage.querySelector('[data-open="listen"]');
  read.disabled = !flags.read;
  listen.disabled = !(flags.read && flags.audio);
  read.addEventListener("click", () => hooks.onRead?.(book, { listen: false }));
  listen.addEventListener("click", () => hooks.onRead?.(book, { listen: true }));
}

export function initShelf(options = {}) {
  hooks = { ...hooks, ...options };
  els = {
    stage: document.getElementById("stage"),
    chips: document.getElementById("series-chips"),
    count: document.getElementById("shelf-count"),
    query: document.getElementById("shelf-query"),
    clear: document.getElementById("btn-clear-search"),
    layer: document.getElementById("book-layer"),
    bookStage: document.getElementById("book-stage"),
  };
  try {
    state.seriesId = localStorage.getItem(SERIES_KEY) || "all";
  } catch {
    /* private mode */
  }
  els.query.addEventListener("input", () => {
    state.query = els.query.value;
    render();
  });
  els.clear.addEventListener("click", () => {
    state.query = "";
    els.query.value = "";
    render();
  });
  document.getElementById("btn-close-book").addEventListener("click", () => closeCoverBook());
  els.layer.addEventListener("click", (e) => {
    if (e.target === els.layer) closeCoverBook();
  });
}
