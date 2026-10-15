/**
 * Paginated EPUB reader with a page-flip leaf.
 *
 * Text flows into CSS columns one page wide; a page is one column and the
 * flow is moved with translateX. Phones show one page, wide screens a
 * two-page spread. A turn swings a leaf on the spine (rotateY, transform +
 * opacity only). Leaf faces come from a small pool of pre-laid-out clones per
 * chapter, so a turn never re-lays out the chapter while it animates.
 */
import { renderChapter } from "./content.js?v=2";
import { textChapterForSpine, textChapters } from "./listen.js?v=2";

export const FONT_STEPS = [0.95, 1.08, 1.22, 1.38];
export const READER_PREFS_KEY = "libraryread.reader.v1";
export const TURN_MS = 460;
const DRAG_COMMIT = 0.28;
const FLICK_PX_PER_MS = 0.35;

/** Page geometry for a book box. Pure; exported for tests. */
export function pageGeometry(width, height, { spreadMinWidth = 760 } = {}) {
  const w = Math.max(200, Math.floor(width));
  const h = Math.max(240, Math.floor(height));
  const spread = w >= spreadMinWidth && w > h * 1.15;
  const pageW = spread ? Math.floor(w / 2) : w;
  const padX = Math.round(Math.min(46, Math.max(20, pageW * 0.075)));
  const padTop = Math.round(Math.min(44, Math.max(22, h * 0.04)));
  const padBottom = padTop + 6;
  const colW = pageW - padX * 2;
  return {
    spread,
    width: spread ? pageW * 2 : pageW,
    height: h,
    pageW,
    padX,
    padTop,
    padBottom,
    colW,
    gap: padX * 2,
    step: pageW,
    textH: h - padTop - padBottom,
    viewportW: spread ? pageW * 2 - padX * 2 : colW,
  };
}

/** First visible page for a page index (spreads start on even pages). */
export function alignPage(page, spread) {
  const p = Math.max(0, Math.floor(page) || 0);
  return spread ? p - (p % 2) : p;
}

export function lastStart(pages, spread) {
  return alignPage(Math.max(0, pages - 1), spread);
}

/** Where a turn lands: same chapter, a neighbour chapter, or nowhere. */
export function turnTarget({ spineIndex, page, pages, spineCount, spread }, dir) {
  const vis = spread ? 2 : 1;
  if (dir > 0) {
    if (page + vis <= lastStart(pages, spread)) return { spineIndex, page: page + vis };
    if (spineIndex < spineCount - 1) return { spineIndex: spineIndex + 1, page: 0 };
    return null;
  }
  if (page - vis >= 0) return { spineIndex, page: page - vis };
  if (spineIndex > 0) return { spineIndex: spineIndex - 1, page: "end" };
  return null;
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(READER_PREFS_KEY) || "{}");
    return { font: Number.isInteger(raw.font) ? raw.font : 1 };
  } catch {
    return { font: 1 };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

export class Reader {
  /**
   * @param {HTMLElement} book page area (sized by CSS)
   * @param {{ onChange?: (pos: object) => void, onEdge?: (dir: number) => void }} hooks
   */
  constructor(book, hooks = {}) {
    this.book = book;
    this.hooks = hooks;
    this.prefs = loadPrefs();
    this.epub = null;
    this.spine = [];
    this.chapters = [];
    this.spineIndex = 0;
    this.page = 0;
    this.pages = 1;
    this.geo = null;
    this.urls = [];
    this.pools = new Map();
    this.turning = null;
    this.drag = null;

    book.classList.add("reader-book");
    book.innerHTML = `
      <div class="page-paper" aria-hidden="true"></div>
      <div class="page-viewport"><div class="page-flow"></div></div>
      <div class="flip-layer" aria-hidden="true">
        <div class="turn-shadow"></div>
        <div class="leaf-paper"><span class="face-shade"></span></div>
      </div>`;
    this.viewport = book.querySelector(".page-viewport");
    this.flow = book.querySelector(".page-flow");
    this.flipLayer = book.querySelector(".flip-layer");
    this.paperBack = book.querySelector(".leaf-paper");
    this.turnShadow = book.querySelector(".turn-shadow");
    this.applyFont();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRelayout());
    this.resizeObserver.observe(book);
  }

  get spread() {
    return !!this.geo?.spread;
  }

  /** @param {{ spine: object[], read(path: string): Uint8Array|null }} epub */
  open(epub, { spineIndex = 0, fraction = 0 } = {}) {
    this.finishTurn();
    this.epub = epub;
    this.spine = epub.spine || [];
    this.chapters = textChapters(this.spine);
    this.dropPools();
    this.layout();
    const index = Math.min(Math.max(0, spineIndex | 0), Math.max(0, this.spine.length - 1));
    this.renderSpine(index);
    this.page = alignPage(Math.round(fraction * Math.max(0, this.pages - 1)), this.spread);
    this.page = Math.min(this.page, lastStart(this.pages, this.spread));
    this.applyPage();
    this.emit();
  }

  close() {
    this.finishTurn();
    this.revokeUrls();
    this.dropPools();
    this.flow.replaceChildren();
    this.epub = null;
  }

  fraction() {
    return this.pages > 1 ? this.page / (this.pages - 1) : 0;
  }

  position() {
    const textIndex = textChapterForSpine(this.chapters, this.spineIndex);
    const chapter = this.chapters[textIndex];
    return {
      spineIndex: this.spineIndex,
      spineCount: this.spine.length,
      page: this.page,
      pages: this.pages,
      spread: this.spread,
      fraction: this.fraction(),
      textIndex,
      chapterTitle: chapter?.title || "",
    };
  }

  emit() {
    this.book.dataset.spine = String(this.spineIndex);
    this.book.dataset.page = String(this.page);
    this.book.dataset.pages = String(this.pages);
    this.hooks.onChange?.(this.position());
  }

  /* ---------- layout ---------- */

  layout() {
    const rect = this.book.getBoundingClientRect();
    const geo = pageGeometry(rect.width, rect.height);
    this.geo = geo;
    const s = this.book.style;
    s.setProperty("--page-w", `${geo.pageW}px`);
    s.setProperty("--pad-x", `${geo.padX}px`);
    s.setProperty("--pad-top", `${geo.padTop}px`);
    s.setProperty("--text-h", `${geo.textH}px`);
    s.setProperty("--col-w", `${geo.colW}px`);
    s.setProperty("--col-gap", `${geo.gap}px`);
    s.setProperty("--viewport-w", `${geo.viewportW}px`);
    this.book.classList.toggle("is-spread", geo.spread);
    this.flipLayer.style.perspective = `${Math.round(geo.pageW * (geo.spread ? 3.2 : 2.6))}px`;
  }

  scheduleRelayout() {
    if (!this.epub) return;
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = setTimeout(() => this.relayout(), 120);
  }

  relayout() {
    if (!this.epub) return;
    const rect = this.book.getBoundingClientRect();
    const next = pageGeometry(rect.width, rect.height);
    const same =
      this.geo &&
      next.width === this.geo.width &&
      next.height === this.geo.height &&
      next.spread === this.geo.spread;
    if (same) return;
    this.finishTurn();
    const fraction = this.fraction();
    this.layout();
    this.dropPools();
    this.paginate();
    this.page = Math.min(
      alignPage(Math.round(fraction * Math.max(0, this.pages - 1)), this.spread),
      lastStart(this.pages, this.spread)
    );
    this.applyPage();
    this.emit();
  }

  applyFont() {
    const step = Math.min(FONT_STEPS.length - 1, Math.max(0, this.prefs.font));
    this.prefs.font = step;
    this.book.style.setProperty("--reader-font", `${FONT_STEPS[step]}rem`);
  }

  cycleFont() {
    const fraction = this.fraction();
    this.prefs.font = (this.prefs.font + 1) % FONT_STEPS.length;
    savePrefs(this.prefs);
    this.applyFont();
    if (!this.epub) return this.prefs.font;
    this.finishTurn();
    this.dropPools();
    this.paginate();
    this.page = Math.min(
      alignPage(Math.round(fraction * Math.max(0, this.pages - 1)), this.spread),
      lastStart(this.pages, this.spread)
    );
    this.applyPage();
    this.emit();
    return this.prefs.font;
  }

  revokeUrls() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }

  renderSpine(index) {
    const item = this.spine[index];
    const keep = this.pools.get(this.spineIndex);
    this.spineIndex = index;
    const { fragment, urls } = renderChapter(this.epub, item?.path || "", document);
    // Old blob URLs may still be on screen in a turning leaf; free them one turn later.
    const stale = this.urls;
    this.urls = urls;
    setTimeout(() => stale.forEach((u) => URL.revokeObjectURL(u)), TURN_MS * 3);
    const end = document.createElement("span");
    end.className = "flow-end";
    fragment.appendChild(end);
    this.flow.replaceChildren(fragment);
    for (const img of this.flow.querySelectorAll("img")) {
      if (!img.complete) img.addEventListener("load", () => this.onImageLoad(index), { once: true });
    }
    for (const [key, pool] of this.pools) {
      if (key !== index && pool !== keep) this.dropPool(key);
    }
    this.paginate();
    this.schedulePool(index);
  }

  onImageLoad(index) {
    if (index !== this.spineIndex || this.turning) return;
    const fraction = this.fraction();
    this.dropPool(index);
    this.paginate();
    this.page = Math.min(
      alignPage(Math.round(fraction * Math.max(0, this.pages - 1)), this.spread),
      lastStart(this.pages, this.spread)
    );
    this.applyPage();
    this.schedulePool(index);
    this.emit();
  }

  paginate() {
    const step = this.geo.step;
    const prev = this.flow.style.transform;
    this.flow.style.transform = "none";
    const end = this.flow.querySelector(".flow-end");
    let pages = 1;
    if (end) {
      const flowLeft = this.flow.getBoundingClientRect().left;
      const endLeft = end.getBoundingClientRect().left;
      pages = Math.floor((endLeft - flowLeft + 1) / step) + 1;
    }
    if (!(pages >= 1)) pages = Math.max(1, Math.ceil(this.flow.scrollWidth / step));
    this.flow.style.transform = prev;
    this.pages = Math.max(1, pages);
  }

  applyPage() {
    this.flow.style.transform = `translate3d(${-this.page * this.geo.step}px,0,0)`;
  }

  /* ---------- face pool ---------- */

  schedulePool(index) {
    clearTimeout(this.poolTimer);
    this.poolTimer = setTimeout(() => {
      if (index === this.spineIndex && !this.turning) this.poolFor(index);
    }, 60);
  }

  poolFor(index) {
    let pool = this.pools.get(index);
    if (pool && pool.geoKey === this.geoKey()) return pool;
    if (pool) this.dropPool(index);
    const count = this.spread ? 3 : 2;
    const faces = [];
    for (let i = 0; i < count; i += 1) {
      const face = document.createElement("div");
      face.className = "face";
      face.innerHTML = `<div class="face-clip"></div><span class="face-shade"></span>`;
      const clone = this.flow.cloneNode(true);
      clone.style.transform = "none";
      face.firstChild.appendChild(clone);
      face.dataset.spine = String(index);
      this.flipLayer.appendChild(face);
      faces.push({ el: face, flow: clone, shade: face.lastChild, busy: false });
    }
    pool = { faces, geoKey: this.geoKey(), pages: this.pages };
    this.pools.set(index, pool);
    return pool;
  }

  geoKey() {
    return `${this.geo.width}x${this.geo.height}:${this.prefs.font}`;
  }

  dropPool(index) {
    const pool = this.pools.get(index);
    if (!pool) return;
    for (const f of pool.faces) f.el.remove();
    this.pools.delete(index);
  }

  dropPools() {
    for (const key of [...this.pools.keys()]) this.dropPool(key);
  }

  /** A pooled face showing page k of chapter `index` (blank past the end). */
  takeFace(index, k) {
    const pool = this.poolFor(index);
    const face = pool.faces.find((f) => !f.busy);
    face.busy = true;
    const blank = k < 0 || k >= pool.pages;
    face.flow.style.visibility = blank ? "hidden" : "";
    face.flow.style.transform = `translate3d(${-Math.max(0, k) * this.geo.step}px,0,0)`;
    return face;
  }

  /* ---------- turning ---------- */

  next() {
    return this.turn(1);
  }

  prev() {
    return this.turn(-1);
  }

  /** Jump without a leaf (目錄, listen-along chapter change). */
  goTo(spineIndex, { page = 0 } = {}) {
    if (!this.epub) return;
    if (this.turning) {
      // Never yank a page out from under a finger or a running turn.
      this.pendingGoTo = { spineIndex, page };
      return;
    }
    const index = Math.min(Math.max(0, spineIndex | 0), this.spine.length - 1);
    if (index !== this.spineIndex) this.renderSpine(index);
    this.page = page === "end" ? lastStart(this.pages, this.spread) : Math.min(alignPage(page, this.spread), lastStart(this.pages, this.spread));
    this.applyPage();
    this.book.classList.remove("is-jumping");
    void this.book.offsetWidth;
    this.book.classList.add("is-jumping");
    this.emit();
  }

  /** Prepare a turn: faces from the old view, move the base, faces from the new view. */
  prepareTurn(dir) {
    if (!this.epub) return null;
    const from = { spineIndex: this.spineIndex, page: this.page };
    const target = turnTarget(
      { spineIndex: from.spineIndex, page: from.page, pages: this.pages, spineCount: this.spine.length, spread: this.spread },
      dir
    );
    if (!target) return null;
    const spread = this.spread;
    const roles = {};
    if (spread) {
      if (dir > 0) {
        roles.overlay = this.takeFace(from.spineIndex, from.page);
        roles.front = this.takeFace(from.spineIndex, from.page + 1);
      } else {
        roles.overlay = this.takeFace(from.spineIndex, from.page + 1);
        roles.back = this.takeFace(from.spineIndex, from.page);
      }
    } else if (dir > 0) {
      roles.front = this.takeFace(from.spineIndex, from.page);
    } else {
      roles.overlay = this.takeFace(from.spineIndex, from.page);
    }

    if (target.spineIndex !== this.spineIndex) this.renderSpine(target.spineIndex);
    this.page = target.page === "end" ? lastStart(this.pages, spread) : target.page;
    this.applyPage();

    if (spread) {
      if (dir > 0) roles.back = this.takeFace(this.spineIndex, this.page);
      else roles.front = this.takeFace(this.spineIndex, this.page + 1);
    } else if (dir < 0) {
      roles.front = this.takeFace(this.spineIndex, this.page);
    }

    const g = this.geo;
    const leafLeft = spread ? g.pageW : 0;
    const place = (face, left, z) => {
      if (!face) return;
      face.el.style.left = `${left}px`;
      face.el.style.zIndex = String(z);
      face.el.classList.add("is-on");
    };
    if (roles.overlay) place(roles.overlay, dir > 0 ? 0 : spread ? g.pageW : 0, 1);
    place(roles.front, leafLeft, 3);
    place(roles.back, leafLeft, 3);
    if (!roles.back) {
      this.paperBack.style.left = `${leafLeft}px`;
      this.paperBack.classList.add("is-on");
    }
    this.flipLayer.classList.add("is-turning");
    this.book.classList.add("is-turning");
    const turn = { dir, from, roles, p: 0, leafLeft };
    this.turning = turn;
    this.applyTurn(0);
    return turn;
  }

  /** p = 0 → leaf where it starts; p = 1 → leaf landed. */
  applyTurn(p) {
    const t = this.turning;
    if (!t) return;
    t.p = p;
    const angle = t.dir > 0 ? -180 * p : -180 * (1 - p);
    const W = this.geo.pageW;
    const frontOn = angle > -90;
    const { front, back } = t.roles;
    if (front) {
      front.el.style.transform = `rotateY(${angle}deg)`;
      front.el.style.opacity = frontOn ? "1" : "0";
      front.shade.style.opacity = String(Math.min(0.32, Math.abs(angle) / 90 * 0.32));
    }
    const backEl = back ? back.el : this.paperBack;
    backEl.style.transform = `rotateY(${angle}deg) translateX(${W}px) rotateY(180deg)`;
    backEl.style.opacity = frontOn ? "0" : "1";
    const backShade = back ? back.shade : this.paperBack.firstElementChild;
    backShade.style.opacity = String(Math.min(0.3, (180 + angle) / 90 * 0.3));
    const lift = Math.sin((Math.PI * Math.abs(angle)) / 180);
    this.turnShadow.style.left = `${t.leafLeft}px`;
    this.turnShadow.style.opacity = String(0.55 * lift);
  }

  endTurn(committed) {
    const t = this.turning;
    if (!t) return;
    this.turning = null;
    for (const role of Object.values(t.roles)) {
      if (!role) continue;
      role.busy = false;
      role.el.classList.remove("is-on");
      role.el.style.transform = "";
      role.el.style.opacity = "";
    }
    this.paperBack.classList.remove("is-on");
    this.flipLayer.classList.remove("is-turning");
    this.book.classList.remove("is-turning");
    this.turnShadow.style.opacity = "0";
    if (!committed) {
      if (t.from.spineIndex !== this.spineIndex) this.renderSpine(t.from.spineIndex);
      this.page = t.from.page;
      this.applyPage();
    } else {
      this.schedulePool(this.spineIndex);
      this.emit();
    }
    const pending = this.pendingGoTo;
    this.pendingGoTo = null;
    if (pending) this.goTo(pending.spineIndex, { page: pending.page });
  }

  animateTo(target, ms) {
    const t = this.turning;
    if (!t) return Promise.resolve();
    const start = t.p;
    const span = target - start;
    const duration = Math.max(90, ms * Math.abs(span));
    return new Promise((resolve) => {
      const t0 = performance.now();
      t.done = () => {
        cancelAnimationFrame(t.raf);
        this.applyTurn(target);
        this.endTurn(target === 1);
        resolve();
      };
      const frame = (now) => {
        if (this.turning !== t) return;
        const k = Math.min(1, (now - t0) / duration);
        this.applyTurn(start + span * ease(k));
        if (k < 1) t.raf = requestAnimationFrame(frame);
        else t.done();
      };
      t.raf = requestAnimationFrame(frame);
    });
  }

  finishTurn() {
    if (this.turning?.done) this.turning.done();
    else if (this.turning) this.endTurn(true);
  }

  turn(dir) {
    this.finishTurn();
    const t = this.prepareTurn(dir);
    if (!t) {
      this.hooks.onEdge?.(dir);
      this.book.classList.remove("is-edge");
      void this.book.offsetWidth;
      this.book.classList.add("is-edge");
      return Promise.resolve(false);
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.endTurn(true);
      return Promise.resolve(true);
    }
    return this.animateTo(1, TURN_MS).then(() => true);
  }

  /* ---------- input ---------- */

  bindInput() {
    const el = this.book;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !this.epub) return;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), turn: null, lastX: e.clientX, lastT: performance.now(), vx: 0 };
    });
    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      const now = performance.now();
      d.vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
      d.lastX = e.clientX;
      d.lastT = now;
      if (!d.turn) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
        this.finishTurn();
        d.turn = this.prepareTurn(dx < 0 ? 1 : -1);
        if (!d.turn) {
          this.drag = null;
          this.hooks.onEdge?.(dx < 0 ? 1 : -1);
          return;
        }
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }
      if (this.turning !== d.turn) return;
      const width = this.spread ? this.geo.pageW * 2 : this.geo.pageW;
      const p = Math.min(1, Math.max(0, (d.turn.dir > 0 ? -dx : dx) / (width * 0.9)));
      cancelAnimationFrame(d.raf);
      d.raf = requestAnimationFrame(() => this.applyTurn(p));
    });
    const up = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      cancelAnimationFrame(d.raf);
      if (d.turn) {
        if (this.turning !== d.turn) return;
        const flick = d.turn.dir > 0 ? -d.vx : d.vx;
        const commit = d.turn.p > DRAG_COMMIT || flick > FLICK_PX_PER_MS;
        if (e.type === "pointercancel" && d.turn.p < 0.5) this.animateTo(0, TURN_MS);
        else this.animateTo(commit ? 1 : 0, TURN_MS);
        return;
      }
      if (e.type === "pointercancel") return;
      const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (moved > 12 || performance.now() - d.t0 > 600) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (x > 0.62) this.next();
      else if (x < 0.38) this.prev();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
}
