/** Original SVG/CSS covers and spine metrics. No external images. */

import { hashString, seriesIdForBook, seriesMeta } from "./catalog.js?v=5";

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function spineMetrics(book) {
  const h = hashString(book?.id || book?.title || "book");
  const chapters = (book?.chapters || []).length;
  const height = 168 + (h % 58);
  const thickness = Math.max(22, Math.min(36, 20 + Math.min(chapters, 8) + (h % 6)));
  return {
    height,
    thickness,
    lift: 8 + (h % 5),
    lean: (h % 11) - 5,
    hueShift: h % 17,
  };
}

export function coverMark(seriesId) {
  if (seriesId === "school") return "seal";
  if (seriesId === "munroe") return "orbit";
  if (seriesId === "immune") return "cell";
  return "leaf";
}

function schoolArt(accent, ink) {
  return `
    <g fill="none" stroke="${ink}" stroke-width="1.4">
      <path d="M18 78h124" opacity="0.22"/>
      <path d="M18 90h124" opacity="0.18"/>
      <path d="M18 102h124" opacity="0.14"/>
      <path d="M18 114h90" opacity="0.12"/>
      <rect x="28" y="28" width="52" height="38" rx="3" fill="${accent}" fill-opacity="0.12"/>
      <path d="M36 48h36M36 56h28" stroke="${accent}" stroke-width="1.6"/>
      <path d="M108 34c8 0 14 6 14 14v22c-10-4-18-4-28 0V48c0-8 6-14 14-14z" fill="${accent}" fill-opacity="0.18"/>
      <circle cx="122" cy="112" r="18" fill="${accent}"/>
      <path d="M116 112h12M122 106v12" stroke="#f7efe4" stroke-width="2"/>
    </g>`;
}

function munroeArt(accent, ink) {
  return `
    <g fill="none" stroke="${ink}" stroke-width="1.3">
      <path d="M24 40h20M24 48h12" opacity="0.35"/>
      <path d="M24 56h16" opacity="0.25"/>
      <circle cx="108" cy="58" r="22" stroke="${accent}" stroke-width="1.8"/>
      <ellipse cx="108" cy="58" rx="32" ry="10" stroke="${accent}" stroke-width="1.4"/>
      <circle cx="128" cy="50" r="3.2" fill="${accent}" stroke="none"/>
      <path d="M48 150c8-18 6-28 0-36 10 2 16 12 14 28 8-6 16-4 20 4" stroke="${ink}"/>
      <circle cx="48" cy="114" r="5" fill="${ink}" stroke="none"/>
      <path d="M70 168h40" opacity="0.3"/>
    </g>`;
}

function immuneArt(accent, ink) {
  return `
    <g fill="none" stroke="${accent}" stroke-width="1.5">
      <circle cx="86" cy="78" r="36" fill="${accent}" fill-opacity="0.1"/>
      <circle cx="86" cy="78" r="24"/>
      <circle cx="86" cy="78" r="12" fill="${accent}" fill-opacity="0.28"/>
      <circle cx="54" cy="128" r="14" stroke="${ink}" stroke-opacity="0.55"/>
      <circle cx="124" cy="140" r="10" fill="${accent}" fill-opacity="0.2" stroke="${ink}" stroke-opacity="0.4"/>
      <path d="M40 48c18-8 36-8 54 0" stroke="${ink}" stroke-opacity="0.35"/>
    </g>`;
}

function otherArt(accent, ink) {
  return `
    <g fill="none" stroke="${ink}" stroke-width="1.4">
      <path d="M40 150c18-40 28-40 46 0" />
      <path d="M63 110c8-22 18-22 26 0" stroke="${accent}"/>
    </g>`;
}

function seriesArt(seriesId, accent, ink) {
  if (seriesId === "school") return schoolArt(accent, ink);
  if (seriesId === "munroe") return munroeArt(accent, ink);
  if (seriesId === "immune") return immuneArt(accent, ink);
  return otherArt(accent, ink);
}

/** Inline SVG cover. Distinct motif per series; title/author only as text. */
export function coverSvg(book, { width = 160, height = 220 } = {}) {
  const seriesId = seriesIdForBook(book);
  const series = seriesMeta(book);
  const title = escapeXml(book?.title || "Untitled");
  const author = escapeXml(book?.author || series.author);
  const mark = coverMark(seriesId);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220" width="${width}" height="${height}" data-series="${escapeXml(seriesId)}" data-mark="${mark}" role="img" aria-label="${title}">
  <rect width="160" height="220" fill="${series.paper}"/>
  <rect x="8" y="8" width="144" height="204" fill="none" stroke="${series.ink}" stroke-opacity="0.18"/>
  <rect x="0" y="0" width="8" height="220" fill="${series.cloth}"/>
  ${seriesArt(seriesId, series.accent, series.ink)}
  <text x="20" y="188" fill="${series.ink}" font-size="13" font-family="Georgia, 'Iowan Old Style', serif">${title}</text>
  <text x="20" y="206" fill="${series.ink}" fill-opacity="0.7" font-size="9" font-family="system-ui, sans-serif">${author}</text>
</svg>`;
}

export function topicMotifSvg(seriesId, { width = 280, height = 120 } = {}) {
  const series = seriesMeta(seriesId);
  const mark = coverMark(seriesId);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 120" width="${width}" height="${height}" data-series="${escapeXml(series.id)}" data-mark="${mark}" aria-hidden="true">
  <rect width="280" height="120" fill="${series.paper}"/>
  <g transform="translate(70,-20) scale(1.15)">
    ${seriesArt(series.id, series.accent, series.ink)}
  </g>
</svg>`;
}

export function coverUsesExternalImage(svg) {
  const text = String(svg || "");
  if (/<image\b/i.test(text)) return true;
  return /\b(?:href|src|xlink:href)\s*=\s*["'](?:https?:|data:)/i.test(text);
}
