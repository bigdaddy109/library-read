/**
 * EPUB spine item → sanitized DOM for the in-page reader.
 * Rebuilds the tree element by element from an allow-list, so EPUB scripts,
 * event handlers, forms, iframes and the book's own CSS never reach the page.
 * Zip images become blob: URLs (the caller revokes them).
 */
import { mimeForPath, zipPath } from "./epub.js?v=4";

export const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
  "caption", "cite", "code", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
  "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "rb", "rp", "rt",
  "rtc", "ruby", "s", "samp", "section", "small", "span", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);

/** Dropped with their children. Anything else unknown is unwrapped (children kept). */
export const DROP_TAGS = new Set([
  "script", "style", "link", "meta", "title", "head", "iframe", "object", "embed",
  "form", "input", "button", "select", "textarea", "audio", "video", "source", "track",
  "canvas", "template", "noscript", "frame", "frameset", "applet", "base", "math",
]);

const KEEP_ATTRS = new Set(["alt", "title", "lang", "dir", "colspan", "rowspan"]);

export function localName(node) {
  return String(node?.localName || node?.nodeName || "").toLowerCase().replace(/^.*:/, "");
}

/** XHTML first (EPUB 3), then forgiving HTML for sloppy EPUB 2 files. */
export function parseChapterDocument(text) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(text, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.body) {
    doc = parser.parseFromString(text, "text/html");
  }
  return doc;
}

function dirOf(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

/**
 * @param {{ read(path: string): Uint8Array | null }} epub
 * @param {string} chapterPath zip path of the spine item
 * @param {Document} target document that will host the nodes
 * @returns {{ fragment: DocumentFragment, urls: string[], text: string }}
 */
export function renderChapter(epub, chapterPath, target = document) {
  const bytes = epub.read(chapterPath);
  const urls = [];
  const fragment = target.createDocumentFragment();
  if (!bytes) return { fragment, urls, text: "" };
  const doc = parseChapterDocument(new TextDecoder("utf-8").decode(bytes));
  const base = dirOf(chapterPath);
  const blobCache = new Map();

  const imageUrl = (href) => {
    const path = zipPath(base, href);
    if (!path) return "";
    if (blobCache.has(path)) return blobCache.get(path);
    const data = epub.read(path);
    if (!data) return "";
    const url = URL.createObjectURL(new Blob([data], { type: mimeForPath(path, "image/jpeg") }));
    urls.push(url);
    blobCache.set(path, url);
    return url;
  };

  const copy = (node, parent) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parent.appendChild(target.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = localName(child);
      if (DROP_TAGS.has(tag)) continue;
      if (tag === "svg") {
        // Cover pages often wrap one bitmap in <svg><image/></svg>; keep the bitmap only.
        const image = child.getElementsByTagNameNS("*", "image")[0];
        const href =
          image?.getAttribute("href") || image?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        const src = href ? imageUrl(href) : "";
        if (src) {
          const img = target.createElement("img");
          img.src = src;
          img.alt = "";
          img.className = "epub-figure";
          parent.appendChild(img);
        }
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        copy(child, parent);
        continue;
      }
      if (tag === "img") {
        const src = imageUrl(child.getAttribute("src") || "");
        if (!src) continue;
        const img = target.createElement("img");
        img.src = src;
        img.alt = child.getAttribute("alt") || "";
        parent.appendChild(img);
        continue;
      }
      const el = target.createElement(tag === "a" ? "span" : tag);
      for (const attr of child.attributes) {
        const name = attr.localName.toLowerCase();
        if (KEEP_ATTRS.has(name)) el.setAttribute(name, attr.value);
      }
      if (tag === "a") el.className = "epub-link";
      copy(child, el);
      parent.appendChild(el);
    }
  };

  copy(doc.body || doc.documentElement, fragment);
  return { fragment, urls, text: (doc.body?.textContent || "").trim() };
}
