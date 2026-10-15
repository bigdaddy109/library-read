# Library Read — agent notes

Static ebook reader for the shared Drive `Library` folder: EPUB text as turnable book pages, with listen-along when the same book has audio. Sibling of [Library Listen](https://github.com/bigdaddy109/library-listen) (live: https://bigdaddy109.github.io/library-listen/) and deliberately shares its look, its Drive OAuth approach, and its library layout.

Read this before changing code. Plan and status live in [fix_plan.md](fix_plan.md).

## Rules (Jeff, 2026-10-15)

1. **Mobile first, smooth on iPhone Safari.** Animations are transform + opacity only. Test every change at 390px in WebKit.
2. **Traditional Chinese UI wherever Library Listen uses it** (書架, 封面牆, 用 Google 登入, 聽 / 讀, 放回 …). Reuse its wording when the same control exists.
3. **Free features and libraries only.** No paid APIs, services, fonts, or hosts. If something paid would help, write a proposal in `fix_plan.md` (or the PR) instead of adopting it.
4. **Tag a rollback point on `main` before each change** and push the tag: `git tag pre-<feature>-YYYYMMDD origin/main && git push origin pre-<feature>-YYYYMMDD` (kebab-case feature, UTC date). Put the tag name in the PR body.
5. **Changes go through PRs. Never push to `main`.** Do **not** merge until the reviewer replies exactly `可以合 #N` on that PR (N = that PR's number; approval on another PR does not count). Then the agent merges through GitHub (squash).
6. **After merge, test on the live GitHub Pages site** (https://bigdaddy109.github.io/library-read/), not only localhost. If it fails, roll back to the `pre-…` tag through a revert PR (same 可以合 flow).
7. **Acceptance before calling anything live** (see [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)): a multi-series fixture that mimics the Drive Library; for every series open at least one ebook, turn pages, and play listen-along; in WebKit at iPhone 390px **and** on desktop, including the old-cache scenario (stale service worker + stale cache). Capture screenshots of each.
8. **No secrets, no copyrighted content.** The OAuth Client ID and Picker key are public browser config. Fixtures are generated text and silent audio only.
9. **Read-only Drive.** Scope is `drive.readonly`. Never upload, write, or rename anything in Drive.
10. **No stubs.** No empty tests or "TODO later" files. Proposals go in `docs/` as prose.

## Data source

Same as Library Listen: Google Identity Services token client, scope `drive.readonly`, finds a folder named `Library` (My Drive + Shared with me; Google Picker as fallback), walks it.

```text
Library/
  <Series>/listen/<book folder or files>   audio (mp3, m4a, m4b, aac)
  <Series>/ebooks/<book>.epub              EPUB, paired to listen/ by slug
```

Pairing rules come from Library Listen's `library.js` (`buildLibrary`) unchanged. Skip `_source/`, names starting with `_` or `.`.

- OAuth Client ID / Picker key: [`docs/drive.js`](docs/drive.js) — the **same** Web client as Library Listen. Its authorized JavaScript origin is `https://bigdaddy109.github.io` (origin only, no path), which already covers `/library-read/`. Local preview: `http://127.0.0.1:8080`.
- Audio streams through the service worker proxy `./drive-media/<fileId>` (Range-aware, never cached). EPUBs download with the token and are kept in IndexedDB (`library-read` → `ebooks`) so reopening is instant.
- Storage keys are prefixed `libraryread.` so they never collide with Library Listen on the shared `bigdaddy109.github.io` origin.

## Layout

The site **is** `docs/` (GitHub Pages: `main` `/docs`). Vanilla ES modules, no bundler, no framework.

| File | Role |
| --- | --- |
| `docs/index.html`, `docs/styles.css` | Shell: cover wall, book layer, reader, listen bar |
| `docs/app.js` | Wiring: Drive sign-in, library load + snapshot, open book, SW registration |
| `docs/shelf.js` | Cover wall + `openCoverBook` (zoom → hinge left), ported from Library Listen |
| `docs/reader.js` | Paginated reader (CSS columns) with page-flip leaf + swipe |
| `docs/content.js` | EPUB chapter → sanitized DOM (no scripts, no EPUB CSS, zip images as blob URLs) |
| `docs/listen.js` | Listen-along: chapter-level audio ↔ text alignment |
| `docs/library.js`, `docs/drive.js`, `docs/epub.js`, `docs/catalog.js`, `docs/covers.js`, `docs/search.js` | Ported from Library Listen (keys/names adapted) |
| `docs/sw.js` | Shell-only cache + Drive media proxy |

## Cache-bust

Shell version is a hand-maintained integer `N`. When any shell file changes, bump **all** of: `?v=N` in `docs/index.html`, every `?v=N` import in `docs/*.js`, and `CACHE = "library-read-shell-vN"` plus `ASSETS` in `docs/sw.js`. `test/pwa-cache.test.mjs` fails if they drift.

## Checks

```bash
for f in docs/*.js; do node --check "$f"; done
node --test
npx playwright test          # needs @playwright/test + chromium + webkit
```

CI (`.github/workflows/acceptance.yml`, free GitHub runners) runs the same.

Preview: `node e2e/server.mjs` then http://127.0.0.1:8080/. The multi-series Drive fixture (fake GIS + fake Drive API) is injected only by the Playwright suite (`e2e/drive-fixture.mjs`); the shipped site has no test hooks.
