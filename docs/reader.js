/**
 * Paginated EPUB reader with a paper page-curl.
 *
 * Text flows into CSS columns one page wide; a page is one column and the
 * flow is moved with translateX. Phones show one page, wide screens a
 * two-page spread. A turn peels the sheet around a moving cylinder so the
 * grabbed corner stays on the finger: the verso faces up with a shadow, and
 * the page underneath shows through. While a finger is down, each frame
 * writes only transform and opacity (geometry is cached when the gesture
 * starts). Leaf faces come from a small pool of pre-laid-out clones per
 * chapter, sliced into strips once at the start of the turn.
 */
import { renderChapter } from "./content.js?v=6";
import { textChapterForSpine, textChapters } from "./listen.js?v=6";

export const FONT_STEPS = [0.95, 1.08, 1.22, 1.38];
export const READER_PREFS_KEY = "libraryread.reader.v1";
export const TURN_MS = 460;
/** Past this fraction of the page, letting go finishes the turn. */
export const RELEASE_FAR = 0.5;
export const FLICK_PX_PER_MS = 0.45;

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

/** Soft settle with a little overshoot, for a page that falls back. */
function springEase(t) {
  const decay = Math.exp(-4.6 * t);
  return 1 - decay * Math.cos(t * Math.PI * 1.15);
}

/**
 * Which way a gesture turns, and which corner leads.
 * Right and left edges pick a direction even when the pull is steep.
 * Top and bottom edges use the nearer side, unless the finger is clearly sideways.
 */
export function classifyGrab({ x, y, width, height, dx = 0, dy = 0 }) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const nx = clamp(x / w, 0, 1);
  const ny = clamp(y / h, 0, 1);
  const sideways = Math.abs(dx) >= 8 && Math.abs(dx) >= Math.abs(dy) * 0.55;
  let dir;
  if (nx >= 0.72) dir = 1;
  else if (nx <= 0.28) dir = -1;
  else if (sideways) dir = dx < 0 ? 1 : -1;
  else dir = nx >= 0.5 ? 1 : -1;
  let corner = "middle";
  if (ny <= 0.33) corner = "top";
  else if (ny >= 0.67) corner = "bottom";
  return { dir, corner };
}

/**
 * Release inertia. A long drag finishes. A short one springs back,
 * unless the finger is still moving hard enough to carry the page.
 */
export function releasePlan({ p, vx = 0, dir = 1 }) {
  const forward = dir > 0 ? -vx : vx;
  if (forward > FLICK_PX_PER_MS && p > 0.16) return { target: 1, spring: false };
  if (forward < -FLICK_PX_PER_MS && p < 0.72) return { target: 0, spring: true };
  if (p >= RELEASE_FAR) return { target: 1, spring: false };
  return { target: 0, spring: true };
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
 * The peeled part is one paper verso whose tip sits on the finger. A corner grab
 * tilts the crease; an edge grab stays closer to a cylinder. Shade, sheen, and
 * the cast shadow follow how tight the bend is. `fx` is the free edge in leaf
 * pixels (0 = spine, pageW = flat). Pure: no DOM.
 */
export function curlPose({ pageW, pageH, fx, bendY = 0, corner = "bottom", strips = CURL_STRIPS }) {
  const edge = clamp(fx, 0, pageW);
  const peel = pageW - edge;
  const yAt = bendY || 0;
  const lift = pageW > 0 ? peel / pageW : 0;
  const bend = Math.sin(Math.min(1, lift) * Math.PI);
  const fold = clamp(edge + peel * 0.86, 0, pageW);
  const seg = pageW / Math.max(1, strips);
  const active = peel > 1;
  const crease = active ? clamp(0.22 + bend * 0.34, 0, 0.62) : 0;
  const list = [];
  for (let i = 0; i < strips; i += 1) {
    const s0 = i * seg;
    const show = s0 < fold;
    const near = show && fold - s0 < seg * 1.4;
    list.push({
      transform: `translate3d(${cssPx(s0)}, 0px, 0px) rotateY(0deg)`,
      frontOpacity: show ? "1" : "0",
      backOpacity: "0",
      shade: "0",
      frontShade: near ? cssNum(0.08 + bend * 0.28) : "0",
    });
  }
  const scale = pageW > 0 ? Math.max(0, fold - edge) / pageW : 0;
  const curlDeg = -(10 + bend * 22);
  let tilt = clamp(yAt / Math.max(pageH, 1), -1, 1) * 6;
  if (corner === "bottom") tilt += 8 + lift * 10;
  else if (corner === "top") tilt -= 8 + lift * 10;
  return {
    strips: list,
    flap: {
      transform: `translate3d(${cssPx(edge)}, ${cssPx(yAt)}, ${cssPx(10 + bend * 18)}) rotateZ(${cssNum(tilt)}deg) rotateY(${cssNum(curlDeg)}deg) scaleX(${cssNum(scale)})`,
      opacity: active ? "1" : "0",
      shade: cssNum(crease),
    },
    lip: {
      transform: `translate3d(${cssPx(fold - curlRadius(pageW) * 0.55)}, ${cssPx(yAt * 0.25)}, 28px) rotateZ(${cssNum(tilt * 0.35)}deg) rotateY(${cssNum(-36 - bend * 28)}deg)`,
      opacity: active ? cssNum(clamp(0.4 + bend * 0.6, 0, 1)) : "0",
    },
    sheen: {
      opacity: active ? cssNum(clamp(bend * 0.85, 0, 0.9)) : "0",
    },
    shadow: {
      opacity: cssNum(active ? clamp(0.05 + bend * 0.5 + lift * 0.15, 0, 0.72) : 0),
      transform: `translate3d(${cssPx(fold)}, ${cssPx(yAt * 0.2)}, 0px) scaleX(${cssNum(Math.max(0.2, (pageW - fold) / Math.max(pageW, 1)))})`,
    },
    corner: { x: edge, y: yAt },
    fold,
    bend,
    backShowing: active,
  };
}

/** Map animation progress to the free-edge x. p = 0 is the start of that direction's turn. */
export function fxFromProgress(p, dir, pageW) {
  const t = clamp(p, 0, 1);
  return dir > 0 ? pageW * (1 - t) : pageW * t;
}

/**
 * One drag sample. `drag` carries geometry cached at gesture start
 * (`pageW`, `pageH`, `dir`, `x0`, `leafLeft`, `grabX`). No layout reads.
 * Grabbing the turning edge sticks the corner to the finger; a swipe
 * elsewhere moves that edge by the same delta.
 */
function grabbedEdge(drag) {
  const { pageW, dir, grabX, corner } = drag;
  const nearSide = dir > 0 ? grabX >= pageW * 0.62 : grabX <= pageW * 0.38;
  if (nearSide) return true;
  if (corner === "top" || corner === "bottom") return dir > 0 ? grabX >= pageW * 0.4 : grabX <= pageW * 0.6;
  return false;
}

export function stepDrag(drag, point) {
  const { pageW, pageH, dir, x0, leafLeft } = drag;
  const dx = point.clientX - x0;
  const dy = point.clientY - (drag.y0 || 0);
  const fingerX = point.clientX - leafLeft;
  const edgeGrab = grabbedEdge(drag);
  let fx = edgeGrab ? fingerX : dir > 0 ? pageW + dx : dx;
  fx = clamp(fx, 0, pageW);
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
  if (nodes.sheen) nodes.sheen.style.opacity = pose.sheen.opacity;
  const origin = nodes.originX || 0;
  nodes.shadow.style.transform = `translate3d(${cssPx(origin)},0,0) ${pose.shadow.transform}`;
  nodes.shadow.style.opacity = pose.shadow.opacity;
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
  prepareTurn(dir, corner = "middle") {
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
    const turn = { dir, from, roles, p: 0, leafLeft, bendY: 0, dragging: false, corner };
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
    flap.className = "curl-flap is-paper";
    const originY = turn.corner === "top" ? "0%" : turn.corner === "middle" ? "50%" : "100%";
    flap.style.transformOrigin = `0% ${originY}`;
    const flapBack = document.createElement("div");
    flapBack.className = "curl-back";
    const flapShade = document.createElement("span");
    flapShade.className = "face-shade curl-back-shade";
    const sheen = document.createElement("span");
    sheen.className = "curl-sheen";
    flapBack.append(flapShade, sheen);
    flap.appendChild(flapBack);
    const lip = document.createElement("div");
    lip.className = "curl-lip";
    lip.style.transformOrigin = `0% ${originY}`;
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
    turn.nodes = { root, strips, flap, flapShade, sheen, lip, shadow: this.turnShadow, originX: turn.leafLeft };
    turn.fx = fxFromProgress(0, turn.dir, pageW);
  }

  /** p = 0 → leaf where it starts; p = 1 → leaf landed. */
  applyTurn(p) {
    const t = this.turning;
    if (!t) return;
    t.p = p;
    if (!t.dragging) t.fx = fxFromProgress(p, t.dir, this.geo.pageW);
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
      corner: t.corner || "middle",
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
    }
    const pending = this.pendingGoTo;
    this.pendingGoTo = null;
    if (pending) this.goTo(pending.spineIndex, { page: pending.page });
  }

  animateTo(target, ms, { spring = false } = {}) {
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
        const eased = spring ? springEase(k) : ease(k);
        const bounce = spring ? Math.sin(k * Math.PI) * Math.exp(-2.2 * k) * startBend * 0.35 : 0;
        t.bendY = startBend * (1 - eased) + bounce;
        this.applyTurn(clamp(start + span * eased, 0, 1));
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

  /** Gesture start only. Later move events go through stepDrag + paintCurl. */
  beginDrag(d, e) {
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.hypot(dx, dy) < 10) return;
    this.finishTurn();
    const grab = classifyGrab({
      x: d.x0 - d.bookLeft,
      y: d.y0 - d.bookTop,
      width: d.bookWidth,
      height: d.bookHeight,
      dx,
      dy,
    });
    const { dir } = grab;
    const turn = this.prepareTurn(dir, grab.corner);
    if (!turn) {
      this.drag = null;
      this.hooks.onEdge?.(dir);
      return;
    }
    d.turn = turn;
    d.dir = dir;
    d.corner = grab.corner;
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
        bookHeight: rect.height,
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
        const plan = releasePlan({ p: d.turn.p, vx: d.vx, dir: d.turn.dir });
        if (e.type === "pointercancel" && d.turn.p < RELEASE_FAR) this.animateTo(0, 340, { spring: true });
        else this.animateTo(plan.target, plan.spring ? 340 : TURN_MS, { spring: plan.spring });
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
