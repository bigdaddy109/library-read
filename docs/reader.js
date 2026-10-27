/**
 * Paginated EPUB reader with a paper page-curl.
 *
 * Text flows into CSS columns one page wide; a page is one column and the
 * flow is moved with translateX. Phones show one page. A wide screen shows a
 * two-page spread whose turn hinges on the center gutter, so the sheet can
 * cross onto the facing page. A drag sets the progress and can be held there.
 * Releasing past the threshold, or a flick, finishes the turn; a short release
 * springs back. A tap plays the whole turn. 快速換頁 skips the curl for a
 * short fade. While a finger is down, each frame writes only transform and
 * opacity (geometry is cached when the gesture starts). Leaf faces come from
 * a small pool of pre-laid-out clones per chapter, sliced into strips once
 * at the start of the turn.
 */
import { renderChapter } from "./content.js?v=11";
import { textChapterForSpine, textChapters } from "./listen.js?v=11";

export const FONT_STEPS = [0.95, 1.08, 1.22, 1.38];
export const READER_PREFS_KEY = "libraryread.reader.v1";
export const TURN_MS = 460;
export const FAST_FADE_MS = 160;
const DRAG_COMMIT = 0.28;
const FLICK_PX_PER_MS = 0.35;
/** A pause this long drops flick speed, so a held page stays until release. */
export const HOLD_MS = 90;

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

/** Strips in the curl mesh. Built once per turn, then only transformed. */
export const CURL_STRIPS = 14;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function cssPx(n) {
  return `${Math.round(n * 100) / 100}px`;
}

function cssNum(n) {
  return String(Math.round(n * 1000) / 1000);
}

/** How wide the curled lip is. The verso flap is one layer; the text stays in flat slices. */
export function curlRadius(pageW) {
  return clamp(pageW * 0.12, 22, 56);
}

/**
 * Curl for one frame.
 * The sheet left of the crease stays flat (so the type is not sliced into a fan).
 * The peeled part is one verso flap whose tip sits on the finger, bent with
 * rotateY / rotateZ, plus a lip and a cast shadow at the crease.
 * `fx` is the free edge in leaf pixels (0 = spine, pageW = flat). Pure: no DOM.
 */
export function curlPose({ pageW, pageH, fx, bendY = 0, strips = CURL_STRIPS }) {
  const edge = clamp(fx, 0, pageW);
  const flapX = fx < 0 ? fx : edge;
  const peel = pageW - edge;
  const fold = clamp(edge + peel * 0.46, 0, pageW);
  const yAt = bendY || 0;
  const seg = pageW / Math.max(1, strips);
  const active = peel > 1;
  const list = [];
  for (let i = 0; i < strips; i += 1) {
    const s0 = i * seg;
    const show = s0 < fold;
    list.push({
      transform: `translate3d(${cssPx(s0)}, 0px, 0px) rotateY(0deg)`,
      frontOpacity: show ? "1" : "0",
      backOpacity: "0",
      shade: "0",
      frontShade: show && fold - s0 < seg ? "0.16" : "0",
    });
  }
  const scale = pageW > 0 ? Math.max(0, fold - edge) / pageW : 0;
  const curlDeg = -Math.min(28, peel * 0.1);
  const tilt = clamp(yAt / Math.max(pageW, 1), -0.28, 0.28) * (180 / Math.PI);
  const lift = Math.min(1, peel / Math.max(1, pageW));
  return {
    strips: list,
    flap: {
      transform: `translate3d(${cssPx(flapX)}, ${cssPx(yAt)}, 18px) rotateZ(${cssNum(tilt)}deg) rotateY(${cssNum(curlDeg)}deg) scaleX(${cssNum(scale)})`,
      opacity: active ? "1" : "0",
      shade: cssNum(active ? Math.min(0.92, 0.62 + lift * 0.2) : 0),
    },
    lip: {
      transform: `translate3d(${cssPx(fold - curlRadius(pageW) * 0.35)}, ${cssPx(yAt * 0.22)}, 24px) rotateY(-36deg)`,
      opacity: active ? "1" : "0",
    },
    shadow: {
      opacity: cssNum(active ? Math.min(0.72, 0.26 + lift * 0.42 + Math.min(0.12, Math.abs(yAt) / Math.max(pageH, 1))) : 0),
      transform: `translate3d(${cssPx(fold)}, ${cssPx(yAt * 0.18)}, 0px) scaleX(${cssNum(Math.max(0.18, (pageW - fold) / Math.max(pageW, 1)))})`,
    },
    corner: { x: flapX, y: yAt },
    fold,
    backShowing: active,
  };
}

/**
 * Hinge x inside the book. A phone leaf starts at the outer edge.
 * A spread leaf starts on the center gutter.
 */
export function leafAnchor(spread, pageW) {
  return spread ? pageW : 0;
}

/**
 * Map animation progress to the free-edge x. p = 0 is flat.
 * On a forward spread, p = 1 has crossed the gutter onto the facing page
 * (`crossGutter`). A phone turn still ends at the spine (x = 0).
 */
export function fxFromProgress(p, dir, pageW, crossGutter = false) {
  const t = clamp(p, 0, 1);
  if (crossGutter && dir > 0) return pageW * (1 - 2 * t);
  return dir > 0 ? pageW * (1 - t) : pageW * t;
}

/**
 * Drag progress uses one page width, so a flick or a short pull can finish
 * the turn. A forward spread then plays that progress across both pages.
 */
export function settleProgress(p, { spread = false, dir = 1 } = {}) {
  const t = Number(p) || 0;
  if (spread && dir > 0) return clamp(t / 2, 0, 1);
  return clamp(t, 0, 1);
}

/** Release after a drag. A held finger does not count as a flick. */
export function releaseDecision({ p = 0, flick = 0, held = false } = {}) {
  const flung = !held && flick > FLICK_PX_PER_MS;
  if (flung || p > DRAG_COMMIT) return "commit";
  return "spring";
}

/** Curl stays the default. Only an explicit fast value turns the curl off. */
export function normalizePrefs(raw) {
  const font = Number.isInteger(raw?.font) ? raw.font : 1;
  return { font, turn: raw?.turn === "fast" ? "fast" : "curl" };
}

/**
 * One drag sample. `drag` carries geometry cached at gesture start
 * (`pageW`, `pageH`, `dir`, `x0`, `leafLeft`, `grabX`). No layout reads.
 * Grabbing the turning edge sticks the corner to the finger; a swipe
 * elsewhere moves that edge by the same delta.
 */
export function stepDrag(drag, point) {
  const { pageW, pageH, dir, x0, leafLeft, grabX } = drag;
  const dx = point.clientX - x0;
  const dy = point.clientY - (drag.y0 || 0);
  const fingerX = point.clientX - leafLeft;
  const edgeGrab = dir > 0 ? grabX >= pageW * 0.55 : grabX <= pageW * 0.45;
  let fx = edgeGrab ? fingerX : dir > 0 ? pageW + dx : dx;
  const cross = !!drag.spread && dir > 0;
  fx = clamp(fx, cross ? -pageW : 0, pageW);
  const p = dir > 0 ? (pageW - fx) / pageW : fx / pageW;
  const limit = pageH * 0.55;
  return { fx, p, bendY: clamp(dy, -limit, limit), edgeGrab };
}

/** Write one curl frame. Only transform and opacity — never top/left/width/height. */
export function applyCurlStyles(nodes, pose) {
  const strips = nodes.strips;
  for (let i = 0; i < strips.length; i += 1) {
    const node = strips[i];
    const poseStrip = pose.strips[i];
    node.root.style.transform = poseStrip.transform;
    node.front.style.opacity = poseStrip.frontOpacity;
    node.back.style.opacity = poseStrip.backOpacity;
    node.shade.style.opacity = poseStrip.shade;
    node.frontShade.style.opacity = poseStrip.frontShade;
  }
  nodes.flap.style.transform = pose.flap.transform;
  nodes.flap.style.opacity = pose.flap.opacity;
  nodes.flapShade.style.opacity = pose.flap.shade;
  nodes.lip.style.transform = pose.lip.transform;
  nodes.lip.style.opacity = pose.lip.opacity;
  const origin = nodes.originX || 0;
  nodes.shadow.style.transform = `translate3d(${cssPx(origin)},0,0) ${pose.shadow.transform}`;
  nodes.shadow.style.opacity = pose.shadow.opacity;
}

function loadPrefs() {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(READER_PREFS_KEY) || "{}"));
  } catch {
    return normalizePrefs(null);
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
    this.applyTurnMode();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRelayout());
    this.resizeObserver.observe(book);
  }

  get spread() {
    return !!this.geo?.spread;
  }

  get turnMode() {
    return this.prefs.turn === "fast" ? "fast" : "curl";
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
    this.book.dataset.hinge = geo.spread ? "gutter" : "edge";
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

  applyTurnMode() {
    this.book.classList.toggle("is-fast", this.turnMode === "fast");
  }

  /** Curl is the default. Fast is a short fade with no page curl. */
  toggleFastTurn() {
    this.finishTurn();
    this.prefs.turn = this.turnMode === "fast" ? "curl" : "fast";
    savePrefs(this.prefs);
    this.applyTurnMode();
    return this.turnMode;
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
    const leafLeft = leafAnchor(spread, g.pageW);
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
    const turn = { dir, from, roles, p: 0, leafLeft, bendY: 0, dragging: false };
    this.turning = turn;
    this.mountCurl(turn);
    this.applyTurn(0);
    return turn;
  }

  /** Slice the outgoing/incoming face into a strip mesh. Once per turn, not per frame. */
  mountCurl(turn) {
    const front = turn.roles.front;
    if (!front || !this.geo) return;
    const pageW = this.geo.pageW;
    const n = CURL_STRIPS;
    const seg = pageW / n;
    const root = document.createElement("div");
    root.className = "curl-root";
    root.style.width = `${pageW}px`;
    root.style.transform = `translate3d(${turn.leafLeft}px,0,0)`;
    const strips = [];
    for (let i = 0; i < n; i += 1) {
      const el = document.createElement("div");
      el.className = "curl-strip";
      el.style.width = `${seg + 2}px`;
      el.style.zIndex = String(8 + i);
      const frontWrap = document.createElement("div");
      frontWrap.className = "curl-front";
      const slice = front.el.cloneNode(true);
      slice.classList.add("is-on");
      slice.style.visibility = "visible";
      slice.style.opacity = "1";
      slice.style.left = "0px";
      slice.style.top = "0px";
      slice.style.zIndex = "auto";
      slice.style.width = `${pageW}px`;
      slice.style.transform = `translate3d(${-i * seg}px,0,0)`;
      frontWrap.appendChild(slice);
      const frontShade = document.createElement("span");
      frontShade.className = "face-shade curl-front-shade";
      frontWrap.appendChild(frontShade);
      const back = document.createElement("div");
      back.className = "curl-back";
      const shade = document.createElement("span");
      shade.className = "face-shade curl-back-shade";
      back.appendChild(shade);
      el.append(frontWrap, back);
      root.appendChild(el);
      strips.push({ root: el, front: frontWrap, back, shade, frontShade });
    }
    const flap = document.createElement("div");
    flap.className = "curl-flap";
    const flapBack = document.createElement("div");
    flapBack.className = "curl-back";
    const flapShade = document.createElement("span");
    flapShade.className = "face-shade curl-back-shade";
    flapBack.appendChild(flapShade);
    flap.appendChild(flapBack);
    const lip = document.createElement("div");
    lip.className = "curl-lip";
    root.append(flap, lip);
    this.flipLayer.appendChild(root);
    // The mesh replaces these faces. Drop is-on so a visibility check finds a strip, not an empty card.
    front.el.classList.remove("is-on");
    front.el.style.visibility = "hidden";
    if (turn.roles.back) {
      turn.roles.back.el.classList.remove("is-on");
      turn.roles.back.el.style.visibility = "hidden";
    }
    this.paperBack.style.opacity = "0";
    turn.nodes = { root, strips, flap, flapShade, lip, shadow: this.turnShadow, originX: turn.leafLeft };
    turn.fx = fxFromProgress(0, turn.dir, pageW);
  }

  /** p = 0 → leaf where it starts; p = 1 → leaf landed. */
  applyTurn(p) {
    const t = this.turning;
    if (!t) return;
    t.p = p;
    if (!t.dragging) t.fx = fxFromProgress(p, t.dir, this.geo.pageW, !!(this.spread && t.dir > 0));
    this.paintCurl();
  }

  /* per-frame drag paint: transform and opacity only */
  paintCurl() {
    const t = this.turning;
    if (!t?.nodes || !this.geo) return;
    const pose = curlPose({
      pageW: this.geo.pageW,
      pageH: this.geo.height,
      fx: t.fx,
      bendY: t.bendY || 0,
    });
    applyCurlStyles(t.nodes, pose);
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
      role.el.style.visibility = "";
    }
    this.paperBack.classList.remove("is-on");
    this.paperBack.style.opacity = "";
    t.nodes?.root?.remove();
    this.flipLayer.classList.remove("is-turning");
    this.book.classList.remove("is-turning");
    this.turnShadow.style.opacity = "0";
    this.turnShadow.style.transform = "";
    if (!committed) {
      if (t.from.spineIndex !== this.spineIndex) this.renderSpine(t.from.spineIndex);
      this.page = t.from.page;
      this.applyPage();
    } else {
      this.schedulePool(this.spineIndex);
      this.emit();
      this.hooks.onUserTurn?.(this.position());
    }
    const pending = this.pendingGoTo;
    this.pendingGoTo = null;
    if (pending) this.goTo(pending.spineIndex, { page: pending.page });
  }

  animateTo(target, ms) {
    const t = this.turning;
    if (!t) return Promise.resolve();
    t.dragging = false;
    const start = t.p;
    const startBend = t.bendY || 0;
    const span = target - start;
    const duration = Math.max(90, ms * Math.abs(span));
    return new Promise((resolve) => {
      const t0 = performance.now();
      t.done = () => {
        cancelAnimationFrame(t.raf);
        t.bendY = 0;
        this.applyTurn(target);
        this.endTurn(target === 1);
        resolve();
      };
      const frame = (now) => {
        if (this.turning !== t) return;
        const k = Math.min(1, (now - t0) / duration);
        const eased = ease(k);
        t.bendY = startBend * (1 - eased);
        this.applyTurn(start + span * eased);
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

  /** Page change with no curl: the new page fades in. */
  fastTurn(dir) {
    if (!this.epub) return Promise.resolve(false);
    const target = turnTarget(
      { spineIndex: this.spineIndex, page: this.page, pages: this.pages, spineCount: this.spine.length, spread: this.spread },
      dir
    );
    if (!target) {
      this.hooks.onEdge?.(dir);
      this.book.classList.remove("is-edge");
      void this.book.offsetWidth;
      this.book.classList.add("is-edge");
      return Promise.resolve(false);
    }
    if (target.spineIndex !== this.spineIndex) this.renderSpine(target.spineIndex);
    this.page = target.page === "end" ? lastStart(this.pages, this.spread) : target.page;
    this.applyPage();
    this.emit();
    this.hooks.onUserTurn?.(this.position());
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.book.classList.remove("is-fast-turn");
      void this.book.offsetWidth;
      this.book.classList.add("is-fast-turn");
    }
    return Promise.resolve(true);
  }

  turn(dir) {
    this.finishTurn();
    if (this.turnMode === "fast") return this.fastTurn(dir);
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

  /** Gesture start only. Later move events go through stepDrag + paintCurl. */
  beginDrag(d, e) {
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.hypot(dx, dy) < 10) return;
    if (this.turnMode === "fast") return;
    this.finishTurn();
    // A sideways drag picks the direction. A steep pull from a corner peels that side.
    const localX = d.x0 - d.bookLeft;
    const dir =
      Math.abs(dx) >= 8 && Math.abs(dx) >= Math.abs(dy) * 0.55 ? (dx < 0 ? 1 : -1) : localX > d.bookWidth * 0.5 ? 1 : -1;
    const turn = this.prepareTurn(dir);
    if (!turn) {
      this.drag = null;
      this.hooks.onEdge?.(dir);
      return;
    }
    d.turn = turn;
    d.dir = dir;
    d.spread = this.spread;
    d.pageW = this.geo.pageW;
    d.pageH = this.geo.height;
    d.leafLeft = d.bookLeft + turn.leafLeft;
    d.grabX = d.x0 - d.leafLeft;
    try {
      this.book.setPointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.queueDrag(d, e);
  }

  /* per-frame drag: cached geometry + pointer coords, then transform/opacity */
  queueDrag(d, e) {
    if (this.turning !== d.turn) return;
    const sample = stepDrag(d, e);
    d.turn.fx = sample.fx;
    d.turn.p = sample.p;
    d.turn.bendY = sample.bendY;
    d.turn.dragging = true;
    cancelAnimationFrame(d.raf);
    d.raf = requestAnimationFrame(() => {
      if (this.turning !== d.turn) return;
      this.paintCurl();
    });
  }

  bindInput() {
    const el = this.book;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !this.epub) return;
      const rect = el.getBoundingClientRect();
      this.drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        turn: null,
        lastX: e.clientX,
        lastT: performance.now(),
        vx: 0,
        bookLeft: rect.left,
        bookTop: rect.top,
        bookWidth: rect.width,
      };
    });
    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const now = performance.now();
      d.vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
      d.lastX = e.clientX;
      d.lastT = now;
      if (!d.turn) {
        this.beginDrag(d, e);
        return;
      }
      this.queueDrag(d, e);
    });
    const up = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      cancelAnimationFrame(d.raf);
      if (d.turn) {
        if (this.turning !== d.turn) return;
        const held = performance.now() - d.lastT > HOLD_MS;
        const flick = d.turn.dir > 0 ? -d.vx : d.vx;
        const decision = e.type === "pointercancel" && d.turn.p < 0.5 ? "spring" : releaseDecision({ p: d.turn.p, flick, held });
        d.turn.p = settleProgress(d.turn.p, { spread: this.spread, dir: d.turn.dir });
        this.animateTo(decision === "commit" ? 1 : 0, TURN_MS);
        return;
      }
      if (e.type === "pointercancel") return;
      const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (this.turnMode === "fast" && moved > 12) {
        const dx = e.clientX - d.x0;
        if (Math.abs(dx) < 8) return;
        const dir = dx < 0 ? 1 : -1;
        const held = performance.now() - d.lastT > HOLD_MS;
        const flick = dir > 0 ? -d.vx : d.vx;
        const travel = this.geo?.pageW || 1;
        const p = Math.min(1, Math.abs(dx) / travel);
        if (releaseDecision({ p, flick, held }) === "commit") this.turn(dir);
        return;
      }
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
