/** Build small EPUB 3 files in memory (STORE zip). Text is generated filler, not book content. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{ name: string, data: Uint8Array | string }[]} files */
export function zipStore(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = typeof file.data === "string" ? enc.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ZH_LINES = [
  "早上的風從操場那頭吹過來，帶著一點青草和粉筆灰的味道。",
  "他把書包背好，數著走廊上的窗戶，一扇、兩扇、三扇，好像這樣就能把緊張數掉。",
  "老師說每一頁都要慢慢讀，讀完再翻，故事才會乖乖待在腦子裡。",
  "教室後面的書櫃有一格是空的，大家都說那是留給還沒寫完的故事。",
  "下課鐘響的時候，誰也沒有先動，因為窗外剛好有一隻鳥停在欄杆上。",
  "放學的路上，他把今天發生的事情一件一件排好，像在書架上排書一樣。",
];
const EN_LINES = [
  "Suppose you could stack every page you have ever read; how tall would the pile be?",
  "The short answer is surprisingly tall, and the long answer involves a little arithmetic.",
  "A typical page is about a tenth of a millimetre thick, so a thousand pages make a decimetre.",
  "That sounds small until you remember how many pages a curious reader turns in a year.",
  "Air resistance, it turns out, matters far less here than the patience of the person stacking.",
  "We will ignore the librarians, who would certainly object to the whole experiment.",
];

/** Deterministic filler paragraphs; `marker` lets tests find a chapter on screen. */
export function fillerParagraphs({ lang = "zh", count = 14, marker = "" } = {}) {
  const lines = lang === "zh" ? ZH_LINES : EN_LINES;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = lines[i % lines.length];
    const b = lines[(i + 2) % lines.length];
    const c = lines[(i + 4) % lines.length];
    out.push(`${i === 0 && marker ? `${marker} ` : ""}${a}${lang === "zh" ? "" : " "}${b}${lang === "zh" ? "" : " "}${c}`);
  }
  return out;
}

/**
 * @param {{ title: string, author?: string, lang?: string,
 *   chapters: { title: string, paragraphs?: number, marker?: string, text?: string[] }[],
 *   frontMatter?: boolean, hostile?: boolean }} spec
 * `hostile` adds an inline script, an onload handler and loud CSS so tests can prove the reader drops them.
 */
export function buildEpub(spec) {
  const lang = spec.lang || "zh";
  const items = [];
  if (spec.frontMatter !== false) {
    items.push({
      id: "titlepage",
      href: "text/titlepage.xhtml",
      title: "",
      body: `<section class="title"><h1>${esc(spec.title)}</h1><p>${esc(spec.author || "")}</p></section>`,
    });
  }
  spec.chapters.forEach((ch, i) => {
    const paras = (ch.text || fillerParagraphs({ lang, count: ch.paragraphs ?? 14, marker: ch.marker || "" }))
      .map((p) => `<p>${esc(p)}</p>`)
      .join("\n");
    items.push({
      id: `ch${i + 1}`,
      href: `text/ch${String(i + 1).padStart(2, "0")}.xhtml`,
      title: ch.title,
      body: `<h2>${esc(ch.title)}</h2>\n${paras}${spec.hostile ? "\n<script>window.__epubScriptRan = true;</script>" : ""}`,
    });
  });
  const xhtml = (title, body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}"><head><title>${esc(title)}</title><link rel="stylesheet" href="../style.css"/></head><body${spec.hostile ? ' onload="window.__epubOnload=true"' : ""}>${body}</body></html>`;
  const manifest = items
    .map((it) => `<item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = items.map((it) => `<itemref idref="${it.id}"/>`).join("");
  const navList = items
    .filter((it) => it.title)
    .map((it) => `<li><a href="${it.href}">${esc(it.title)}</a></li>`)
    .join("");
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:library-read:${esc(spec.title)}</dc:identifier><dc:title>${esc(spec.title)}</dc:title><dc:creator>${esc(spec.author || "")}</dc:creator><dc:language>${lang}</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest}</manifest>
<spine>${spine}</spine>
</package>`;
  const nav = xhtml("目錄", `<nav epub:type="toc"><ol>${navList}</ol></nav>`);
  return zipStore([
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/style.css", data: spec.hostile ? "body{color:red;font-size:40px}" : "p{margin:0}" },
    ...items.map((it) => ({ name: `OEBPS/${it.href}`, data: xhtml(it.title || spec.title, it.body) })),
  ]);
}
