# Acceptance checklist

Run before calling a release live, and again on the live site after merge. Automated by `npx playwright test` (`e2e/`), screenshots in `test-results/shots/` (or `SHOTS_DIR`).

## Fixture

`test/library-fixture.mjs` mimics the Drive `Library` folder (generated text + silent audio, no real books):

| Series | Book | listen/ | ebooks/ | Alignment case |
| --- | --- | --- | --- | --- |
| 上學不容易 | Middle School 01 First Day, 02 Get Me | `01.mp3`… per book folder | `<Book>.epub` (Chinese) | equal count |
| 門羅-WhatIf | what-if-1, how-to | named tracks; one whole-book `.m4b` | `what-if-1.epub`, `how-to.epub` | by title; single file |
| Immune | Immune | `Immune-Part01..03.mp3` directly in listen/ | `Immune.epub` (6 chapters) | proportional |
| Thing Explainer | Thing Explainer | — | `Thing Explainer.epub` | ebook only |

Plus `_source/` and `.DS_Store` entries that must be skipped. `test/fake-drive.mjs` serves it as Drive v3 (list by name / parents with paging, `alt=media` with Range, `about`) behind a fake GIS token client.

## Checks (Chromium desktop 1280×800 and WebKit iPhone 13 at 390×844)

- [ ] Signed out: demo book on the cover wall, opens, pages turn.
- [ ] 用 Google 登入 → all 6 fixture books, series chips, status line.
- [ ] Per series (上學不容易, 門羅-WhatIf, Immune, Thing Explainer): cover tap → zoom + hinge-left open → 讀 / 邊聽邊讀; text renders; EPUB scripts/CSS do not apply; tap and drag page turns (mid-flip screenshot); turn back.
- [ ] Per series with audio: 邊聽邊讀 plays through `./drive-media/` ; at the end of track 1, track 2 starts and the text moves to the mapped chapter.
- [ ] 目錄 jump, 字級, 音訊章節 sheet with alignment hint, 對齊 offset, progress restored after reload, audio pauses on ← 書架.
- [ ] A cached EPUB reopens without a second download.
- [ ] Old cache: previous shell (SW + cache + stale 2-book snapshot + EPUB in IndexedDB) upgrades to the current shell; the cached EPUB still opens and turns pages; Chromium also signs in and listens through the SW proxy.
- [ ] A page left open on the old shell does not reload mid-chapter, and upgrades once paused (Chromium).
- [ ] No reload loop when a new SW takes over.

WebKit limits (Playwright, not the site): requests made by — or from pages controlled by — a service worker cannot be stubbed in WebKit, so the WebKit old-cache pass reads the cached EPUB but does not sign in or stream audio. WebKit listen-along is covered by the non-SW pass.

## Live site

After 「可以合 #N」 and merge, with Pages built:

```bash
LIVE_URL=https://bigdaddy109.github.io/library-read/ SHOTS_DIR=… npx playwright test e2e/acceptance.playwright.mjs
```

The same fake Google is injected by Playwright routing on the live origin, so it exercises the deployed files without a real account. A real sign-in on Jeff's iPhone remains the final check.
