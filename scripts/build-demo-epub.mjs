/** Writes docs/sample/demo.epub, the 翻頁試讀 book shown before sign-in. Original text. */
import { writeFileSync } from "node:fs";
import { buildEpub, fillerParagraphs } from "../test/epub-builder.mjs";

const out = new URL("../docs/sample/demo.epub", import.meta.url);
const bytes = buildEpub({
  title: "翻頁試讀",
  author: "Library Read",
  lang: "zh",
  chapters: [
    {
      title: "怎麼翻頁",
      text: [
        "點畫面右邊翻到下一頁，點左邊回到上一頁。",
        "也可以用手指從右往左拖，頁面會跟著手指掀起來；放開時拖過三成就翻過去，不到就輕輕落回原位。",
        "在電腦上，左右方向鍵、PageUp／PageDown 和空白鍵都可以翻頁。寬螢幕會攤開成左右兩頁。",
        "右上角的「目錄」可以跳到任何一章，「Aa」切換字級。讀到哪裡會自動記住，下次打開從同一頁開始。",
        ...fillerParagraphs({ lang: "zh", count: 16 }),
      ],
    },
    {
      title: "邊聽邊讀",
      text: [
        "如果同一本書在 Drive 的 listen 資料夾裡也有音檔，打開書時可以選「邊聽邊讀」。",
        "現在是以章節對齊：一段音訊對到一章文字。這段播完，下一段會自動開始，文字也跟著翻到對應的那一章。",
        "如果對得不準，打開「音訊章節」，翻到正確的章節後按「把這段音訊對齊到目前章節」，之後都會照這個位移。",
        ...fillerParagraphs({ lang: "zh", count: 12 }),
      ],
    },
    {
      title: "從 Drive 讀書",
      text: [
        "按「用 Google 登入」，只要求唯讀權限，讀取名為 Library 的資料夾。",
        "每個系列資料夾裡，ebooks 放 EPUB，listen 放音檔；書名相同就會配成同一本。",
        "打開過的電子書會存在這台裝置上，下次不用重新下載。音檔一律串流，不會存下來。",
        ...fillerParagraphs({ lang: "zh", count: 10 }),
      ],
    },
  ],
});
writeFileSync(out, bytes);
console.log(`wrote ${out.pathname} (${bytes.length} bytes)`);
