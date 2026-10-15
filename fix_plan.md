# Library Read — fix plan

One most-important thing at a time. Check an item only after its acceptance passes.

## v1 — PR #1 (rollback tag `pre-ebook-v1-20261015`)

- [ ] Scaffold: `AGENTS.md` (rules), this plan, `package.json`, CI workflow.
- [ ] Port from Library Listen: `library.js` (scan + pairing), `drive.js` (GIS + drive.readonly, keys renamed `libraryread.*`), `epub.js` (unzip + spine + TOC), cover wall `catalog.js` / `covers.js` / `search.js`.
- [ ] Shelf: 封面牆 with series chips + search; tap → `openCoverBook` (cover zooms to the closed book, front board hinges open to the left) → spread with 讀 / 邊聽邊讀.
- [ ] Reader: EPUB chapter rendered in-page (sanitized, no EPUB scripts/CSS), paginated with CSS columns; one page on phones, two-page spread on wide screens; page-flip leaf (rotateY on the spine, transform/opacity only); swipe with finger-follow, tap zones, arrow keys; 目錄 drawer; font size; progress saved per book.
- [ ] Listen-along (chapter-level): audio chapter list ↔ text chapter list; mapping by TOC title, else equal count, else proportional; when an audio track ends the next one plays and the text jumps to its chapter; manual text jumps while listening re-anchor the offset.
- [ ] Service worker: versioned shell cache, network-first HTML, Drive media proxy (Range, never cached), foreground update checks, no reload mid-chapter.
- [ ] Acceptance (see `docs/ACCEPTANCE.md`): multi-series Drive fixture; per series open an ebook, turn pages, play listen-along; WebKit iPhone 390 + desktop Chromium; stale SW/cache upgrade; screenshots.
- [ ] Mark PR ready → wait for 「可以合 #1」 → merge → live test on https://bigdaddy109.github.io/library-read/ with screenshots.

## Needs Jeff (settings, not code)

- GitHub Pages for `bigdaddy109/library-read`: Settings → Pages → Deploy from a branch → `main` / `/docs`.
- Google OAuth: nothing new if the existing Library Listen Web client is reused (origin `https://bigdaddy109.github.io` already authorized). If the consent screen is in Testing mode, readers must be test users (same list as Library Listen).

## Later

- Word-level (or sentence-level) read-along: proposal in [docs/word-sync-proposal.md](docs/word-sync-proposal.md). Not in v1.
- Within-chapter page follow (estimate page from audio position ÷ chapter duration) — cheap stepping stone before real sync.
- EPUB cover images on the cover wall (v1 uses the same generated SVG covers as Library Listen).
