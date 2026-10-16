# library-read

Ebook reader site: book-like pages from Drive Library EPUBs, with listen-along.

**Live (after Pages is enabled):** https://bigdaddy109.github.io/library-read/

- 封面牆 (cover wall) in Library Listen's rice-paper style; tapping a cover zooms it onto the closed book and swings the front board open to the left.
- 讀: EPUB text as real pages — one page on phones, a two-page spread on wide screens. Tap the right/left side, swipe (the page follows your finger), or use the arrow keys. 目錄, 字級, progress saved per book.
- 邊聽邊讀: if the same book has audio in `listen/`, it plays while you read. v1 aligns by chapter: when a track ends, the next one starts and the text turns to the matching chapter. 音訊章節 lets you re-align (對齊到目前章節).
- Data: 用 Google 登入 (read-only Drive) → folder named `Library` → `<Series>/ebooks/*.epub` paired with `<Series>/listen/…`, exactly like [Library Listen](https://github.com/bigdaddy109/library-listen).

No build step. The site is `docs/` (vanilla ES modules). Rules for contributors and agents: [AGENTS.md](AGENTS.md). Plan: [fix_plan.md](fix_plan.md). Later work: [word-level sync proposal](docs/word-sync-proposal.md).

## Deep link

Library Listen can open a book here. Nothing calls Google on load; a fixed button waits for a tap.

```text
https://bigdaddy109.github.io/library-read/?series=<series folder>&book=<epub name>&ch=<chapter>
```

| Query | Meaning |
| --- | --- |
| `series` | Drive `Library` series folder name, URL-encoded. Example: `上學不容易`, `門羅-WhatIf`. |
| `book` | EPUB file name without `.epub`, URL-encoded. Example: `what-if-1`. |
| `ch` | Optional. Text chapter index starting at 1. Omit it to open at the start. |

Example: `https://bigdaddy109.github.io/library-read/?series=%E4%B8%8A%E5%AD%B8%E4%B8%8D%E5%AE%B9%E6%98%93&book=Middle%20School%2001%20First%20Day&ch=2`

The button says 「用 Google 登入並打開」 until there is a token, then 「打開這本書」. If the series or book is not in the library, the shelf stays up and the status line says 「找不到這本書，已回到書架。」 After sign-in, reading and page turns reuse the token or refresh it with GIS `prompt: ''`. A failed silent refresh shows 「重新授權」 and does not open a popup until that button is tapped.

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
