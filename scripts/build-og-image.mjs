/**
 * Writes docs/og-image.png (1200×630 share preview) in the cover-wall style:
 * rice paper, the same generated SVG covers, 書架 heading.
 * Needs @playwright/test + Chromium: `node scripts/build-og-image.mjs`.
 */
import { chromium } from "@playwright/test";
import { coverSvg } from "../docs/covers.js?v=2";

const OUT = new URL("../docs/og-image.png", import.meta.url).pathname;

const books = [
  { id: "school/first-day", collectionId: "school", title: "開學第一天", author: "上學不容易" },
  { id: "munroe/what-if-1", collectionId: "munroe", title: "What If?", author: "Randall Munroe" },
  { id: "immune/immune", collectionId: "immune", title: "Immune", author: "Philipp Dettmer" },
  { id: "thing-explainer/te", collectionId: "thing-explainer", collectionTitle: "Thing Explainer", title: "Thing Explainer", author: "Randall Munroe" },
];

const covers = books
  .map((b, i) => `<div class="cover c${i}">${coverSvg(b, { width: 200, height: 275 })}</div>`)
  .join("");

const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{font-family:"PingFang TC","Noto Sans TC","WenQuanYi Micro Hei",system-ui,sans-serif;color:#1c1914;
    background:
      repeating-linear-gradient(0deg,rgba(28,25,20,.018) 0 1px,transparent 1px 3px),
      repeating-linear-gradient(90deg,rgba(28,25,20,.012) 0 1px,transparent 1px 4px),
      radial-gradient(80% 60% at 0% 0%,rgba(196,92,62,.10),transparent 55%),
      radial-gradient(70% 50% at 100% 0%,rgba(61,107,106,.09),transparent 50%),
      linear-gradient(180deg,#f7f2e8 0%,#f3eee4 40%,#e8e0d2 100%)}
  .text{position:absolute;left:72px;top:92px;width:470px}
  .eyebrow{margin:0 0 14px;font-size:24px;letter-spacing:.06em;color:#6d6558}
  h1{margin:0;font-family:"Iowan Old Style","Noto Serif TC","Source Han Serif TC","Songti TC",serif;font-size:132px;line-height:1;font-weight:600;letter-spacing:-.03em}
  .lede{margin:30px 0 0;font-size:31px;line-height:1.5;color:#3a332a}
  .chips{display:flex;gap:12px;margin-top:34px}
  .chip{border:2px solid #d8cfc0;border-radius:999px;padding:8px 20px;font-size:22px;background:rgba(255,255,255,.5)}
  .chip.on{background:#1c1914;color:#f3eee4;border-color:#1c1914}
  .wall{position:absolute;right:56px;top:58px;width:560px;height:520px}
  .cover{position:absolute;width:200px;height:275px;border-radius:6px;overflow:hidden;
    box-shadow:0 18px 34px rgba(28,25,20,.22),0 2px 0 rgba(28,25,20,.06)}
  .cover svg{display:block;width:100%;height:100%}
  .c0{left:0;top:30px;transform:rotate(-5deg)}
  .c1{left:180px;top:0;transform:rotate(2deg);z-index:2}
  .c2{left:360px;top:40px;transform:rotate(6deg)}
  .c3{left:120px;top:250px;transform:rotate(-2deg);z-index:3}
  .open{position:absolute;left:330px;top:300px;width:230px;height:190px;z-index:4;transform:rotate(3deg)}
  .open .pg{position:absolute;top:0;width:50%;height:100%;background:#f8f0e1;box-shadow:0 16px 30px rgba(28,25,20,.2)}
  .open .l{left:0;border-radius:8px 2px 2px 8px;background:#f4ead8}
  .open .r{right:0;border-radius:2px 8px 8px 2px;background:linear-gradient(90deg,rgba(28,25,20,.12),transparent 18%),#f8f0e1}
  .open i{position:absolute;height:5px;border-radius:3px;background:rgba(36,28,20,.28)}
</style></head><body>
  <div class="text">
    <p class="eyebrow">LIBRARY READ</p>
    <h1>書架</h1>
    <p class="lede">翻頁讀電子書，<br>有音檔的書可以邊聽邊讀。</p>
    <div class="chips"><span class="chip on">讀</span><span class="chip">邊聽邊讀</span><span class="chip">封面牆</span></div>
  </div>
  <div class="wall">${covers}
    <div class="open"><div class="pg l"></div><div class="pg r"></div>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<i style="left:${n < 4 ? 14 : 129}px;top:${34 + (n % 4) * 34}px;width:${n % 4 === 3 ? 50 : 86}px"></i>`).join("")}
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`wrote ${OUT}`);
