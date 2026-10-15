# library-read

Ebook reader site: book-like pages from Drive Library EPUBs, with listen-along.

**Live (after Pages is enabled):** https://bigdaddy109.github.io/library-read/

- 封面牆 (cover wall) in Library Listen's rice-paper style; tapping a cover zooms it onto the closed book and swings the front board open to the left.
- 讀: EPUB text as real pages — one page on phones, a two-page spread on wide screens. Tap the right/left side, swipe (the page follows your finger), or use the arrow keys. 目錄, 字級, progress saved per book.
- 邊聽邊讀: if the same book has audio in `listen/`, it plays while you read. v1 aligns by chapter: when a track ends, the next one starts and the text turns to the matching chapter. 音訊章節 lets you re-align (對齊到目前章節).
- Data: 用 Google 登入 (read-only Drive) → folder named `Library` → `<Series>/ebooks/*.epub` paired with `<Series>/listen/…`, exactly like [Library Listen](https://github.com/bigdaddy109/library-listen).

No build step. The site is `docs/` (vanilla ES modules). Rules for contributors and agents: [AGENTS.md](AGENTS.md). Plan: [fix_plan.md](fix_plan.md). Later work: [word-level sync proposal](docs/word-sync-proposal.md).

## Setup (one time)

1. **GitHub Pages:** repo Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
2. **Google sign-in:** `docs/drive.js` reuses Library Listen's public Web OAuth client. Its authorized JavaScript origin `https://bigdaddy109.github.io` already covers `/library-read/`, so nothing changes in Google Cloud. While the consent screen is in *Testing*, only listed test users can sign in (same list as Library Listen).

## Develop

```bash
node e2e/server.mjs          # http://127.0.0.1:8080/library-read/
node --test                  # unit tests
npm i --no-save @playwright/test && npx playwright install chromium webkit
npx playwright test          # acceptance: fixture Drive Library, Chromium desktop + WebKit iPhone 390, old shell upgrade
```
