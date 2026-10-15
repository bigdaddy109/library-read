/**
 * Writes docs/og-image.png (1200×630 share preview).
 *
 * Deliberately generic: abstract shelf and book silhouettes, the site name and
 * one line of description. It must not read shelf data (library, covers,
 * catalog) or show any book title or cover, so adding books never requires
 * regenerating it. test/share-preview.test.mjs enforces that.
 *
 * Needs @playwright/test + Chromium: `node scripts/build-og-image.mjs`.
 */
import { chromium } from "@playwright/test";

const OUT = new URL("../docs/og-image.png", import.meta.url).pathname;

/** Rice-paper palette from the cover wall (docs/styles.css), as plain colours. */
const CLOTH = ["#b4532f", "#2f5857", "#7a3040", "#5c564c", "#8a6a3a", "#3f4f6b", "#9c4a36", "#4d6b4a"];

/** Abstract spines on a plank: heights/widths from a fixed pattern, no labels. */
function spines() {
  const widths = [34, 28, 40, 30, 26, 38, 32, 44, 28, 36, 30];
  const heights = [230, 200, 250, 214, 186, 240, 206, 262, 196, 226, 210];
  let x = 0;
  return widths
    .map((w, i) => {
      const h = heights[i];
      const lean = i === 8 ? "transform:rotate(-9deg);transform-origin:0 100%;margin-left:14px" : "";
      const el = `<i class="spine" style="left:${x}px;width:${w}px;height:${h}px;background:${CLOTH[i % CLOTH.length]};${lean}"><b></b></i>`;
      x += w + (i === 8 ? 22 : 6);
      return el;
    })
    .join("");
}

const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{font-family:"PingFang TC","Noto Sans TC","WenQuanYi Micro Hei",system-ui,sans-serif;color:#1c1914;
    background:
      repeating-linear-gradient(0deg,rgba(28,25,20,.018) 0 1px,transparent 1px 3px),
      repeating-linear-gradient(90deg,rgba(28,25,20,.012) 0 1px,transparent 1px 4px),
      radial-gradient(80% 60% at 0% 0%,rgba(196,92,62,.10),transparent 55%),
      radial-gradient(70% 50% at 100% 0%,rgba(61,107,106,.09),transparent 50%),
      linear-gradient(180deg,#f7f2e8 0%,#f3eee4 40%,#e8e0d2 100%)}
  .text{position:absolute;left:76px;top:150px;width:520px}
  h1{margin:0;font-family:"Iowan Old Style","Noto Serif TC","Source Han Serif TC",Georgia,serif;font-size:96px;line-height:1;font-weight:600;letter-spacing:-.02em}
  .rule{width:84px;height:5px;border-radius:3px;background:#c45c3e;margin:34px 0 30px}
  .lede{margin:0;font-size:34px;line-height:1.5;color:#3a332a}
  .shelf{position:absolute;right:70px;top:96px;width:520px;height:330px}
  .spines{position:absolute;left:0;bottom:22px;width:100%;height:280px}
  .spine{position:absolute;bottom:0;display:block;border-radius:3px 4px 1px 2px;
    box-shadow:inset 1px 0 0 rgba(255,255,255,.22),2px 5px 10px rgba(28,25,20,.16);
    background-image:linear-gradient(180deg,rgba(255,255,255,.16),transparent 22%),linear-gradient(90deg,rgba(0,0,0,.32),transparent 30%)}
  .spine b{position:absolute;left:18%;right:18%;top:16%;height:6px;border-radius:1px;background:rgba(247,241,230,.7)}
  .plank{position:absolute;left:-20px;right:-20px;bottom:0;height:22px;border-radius:2px;background:#e6dcc8;
    box-shadow:0 9px 0 #c9b89a,0 16px 22px rgba(28,25,20,.14)}
  .book{position:absolute;right:120px;top:452px;width:340px;height:120px}
  .book .pg{position:absolute;top:0;width:50%;height:100%;box-shadow:0 14px 26px rgba(28,25,20,.18)}
  .book .l{left:0;border-radius:10px 2px 2px 10px;background:#f4ead8;transform:skewY(4deg)}
  .book .r{right:0;border-radius:2px 10px 10px 2px;background:linear-gradient(90deg,rgba(28,25,20,.12),transparent 18%),#f8f0e1;transform:skewY(-4deg)}
  .book i{position:absolute;height:6px;border-radius:3px;background:rgba(36,28,20,.22)}
</style></head><body>
  <div class="text">
    <h1>Library Read</h1>
    <div class="rule"></div>
    <p class="lede">翻頁讀電子書，<br />有音檔的書可以邊聽邊讀。</p>
  </div>
  <div class="shelf"><div class="spines">${spines()}</div><div class="plank"></div></div>
  <div class="book"><div class="pg l"></div><div class="pg r"></div>
    ${[0, 1, 2, 3, 4, 5].map((n) => `<i style="left:${n < 3 ? 22 : 192}px;top:${28 + (n % 3) * 26 + (n < 3 ? 6 : -6)}px;width:${n % 3 === 2 ? 70 : 124}px"></i>`).join("")}
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`wrote ${OUT}`);
