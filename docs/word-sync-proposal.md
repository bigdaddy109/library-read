# Proposal: word / sentence-level listen-along (not in v1)

v1 aligns at the chapter level only: no timestamps exist between the Drive audio and the EPUB text. This is how finer sync could work, cheapest first. Nothing here is built.

## 0. Stepping stone: proportional page follow (free, small)

While a track plays, estimate the page as `position ÷ duration × pages in the mapped chapter` and turn there when 跟著翻章 is on. Wrong by a page or two when narration speed varies, but it needs no data and fits the current reader (`Reader.goTo`). Good enough to validate whether people want "the page follows me".

## 1. Use EPUB 3 Media Overlays when a book has them (free)

Some EPUB 3 files ship SMIL overlays (`<par><text src="ch1.xhtml#w12"/><audio clipBegin=… clipEnd=…/></par>`). Parse the SMIL from the zip, map ids to the rendered DOM, done. Exact, free, no processing — but almost no commercial audiobook/EPUB pair has them, and the overlay audio is the EPUB's own, not the Drive `listen/` files. Worth supporting because it is cheap; not a general answer.

## 2. Offline forced alignment → sidecar file (free, recommended)

Generate timings once per book on a computer, store them next to the EPUB, and let the site read them (still `drive.readonly`).

1. **Transcribe with word timestamps** using an open-source model run locally: `whisper.cpp` (MIT) or `faster-whisper` (MIT) with word timestamps. Both handle Mandarin and English. A Mac mini does roughly real-time-or-faster; an audiobook is a night's batch.
2. **Align transcript ↔ EPUB text** with a sequence alignment (Needleman–Wunsch / difflib) on normalized text — per character for Chinese, per word for English. ASR mistakes and narrator ad-libs become gaps; anchors on either side keep the rest exact. (Alternative aligner: `aeneas`, Apache-2.0, TTS + DTW; weaker on Mandarin.)
3. **Write `ebooks/<book>.sync.json`** (Jeff copies it into Drive):
   ```json
   { "version": 1, "tracks": [
     { "audio": "listen/what-if-1/01 - Introduction.mp3", "spine": "text/ch01.xhtml",
       "segments": [[0.00, 3.42, 0, 57], [3.42, 7.10, 57, 121]] } ] }
   ```
   `[start s, end s, text offset start, text offset end]` in the chapter's plain text. Sentence granularity first (robust, small); words later with the same format.
4. **Site:** `content.js` already rebuilds each chapter's DOM; it records a text-offset → node index while copying. On `timeupdate`, binary-search the segment, build a `Range`, and paint it with the CSS Custom Highlight API (`::highlight`, Safari 17.2+) — no DOM changes, so pagination is untouched. When the highlight's rect moves past the current page, `Reader.next()` turns the page (with the leaf). Tapping a sentence seeks the audio.

Cost: free (local compute + Jeff's time to run a script per book). Risk: alignment quality on noisy or abridged audio; mitigated by sentence granularity and by falling back to chapter-level when a segment's confidence is low.

## 3. In-browser alignment (not recommended)

Whisper in WebAssembly/WebGPU (transformers.js) is free but means 40–150 MB models and hours of audio per book on an iPhone: too slow and battery-hungry.

## Paid option (proposal only — not adopted)

Cloud speech-to-text with word timestamps (Google Cloud Speech-to-Text, Azure Speech, AWS Transcribe) replaces step 2.1: faster, no local setup, roughly US$0.01–0.03 per audio minute (≈ US$6–20 for a 10-hour book). Same alignment and sidecar afterwards. Only worth it if running a local script per book is a burden; needs Jeff's approval and a billing account.

## Suggested order

0 → 2 (sentence-level, one pilot book) → 1 opportunistically → word level if sentence level feels too coarse.
