---
id: 01a0dbc1-60bd-7d0e-aab9-62a10f78260a
title: "read answers a PDF: its text page by page, windowed by pages, and a page with no text layer as a picture"
ord: 129
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0db91-a95d-7cbe-b90b-800107b62a24
---
## 1 Outcome

`read` on a PDF answers its text page by page, windowed by an optional `pages` argument, with the page count named. A page with no text layer — a scan — arrives as a picture through the road [[07b62a24|the picture decision]] built, so the model sees it. A PDF that is encrypted, broken or too large answers a sentence.

## 2 Problem

`read` refuses every PDF by extension ([[4f7ca8f4|read on pictures and PDFs]]), so a spec, a paper or a scanned document is unreadable to a Tagma agent; it has to fall back to a shell tool it may not have.

## 3 What holds now

- The picture road stands: a tool answers `media`, the thread's keeper normalizes and keeps it, the model sees it, a blind row gets words ([[168d5a64]], [[2e820baf]], [[c3f46566]]).
- No PDF engine is in the repository. Anthropic's tool results take `document` blocks, but Bedrock refuses documents in tool results ([[4346ece9]]) and the OpenAI and Gemini adapters lower images only, so a native PDF block would work on one wire of six.
- `read` caps an answer at 2000 lines and 50 KB and names where to continue ([[806d4313]], [[cde27972]]).

## 4 Target model

1. **The engine.** `@embedpdf/pdfium` — PDFium compiled to WebAssembly, MIT with PDFium's Apache-2.0 — added to `@runlith/agent-tools`. It is loaded at the first PDF a process reads, from the installed package's own `pdfium.wasm`, and kept for the process; each document is opened, read and closed within one call, its memory freed.
2. **`pages`.** `read` takes an optional `pages` — one page (`"7"`) or a span (`"3-9"`), 1-based. It applies to PDFs alone and is refused on any other file, as `offset` is refused on a directory. Without it the window opens at page 1.
3. **Text.** Each page in the window answers a `--- page N ---` line and its text layer. The window stops where read's 50 KB cap would be passed, or at 20 pages, and the answer names the page count and the `pages` value that continues.
4. **Scans.** A page in the window whose text layer is empty is rendered to PNG at a scale that fits the picture ceilings (2000 px on the long side) and answered as `media` labelled `<path> page N`. At most 5 pages of one call become pictures; the rest are named with the `pages` value that reads them, so one call cannot fill a context with pictures.
5. **Refusals as sentences.** An encrypted PDF, one PDFium cannot open, or one past 64 MB answers a sentence naming the reason; the call is not failed.
6. **Encoding a rendered page.** PDFium renders to a raw bitmap; `sharp`, already shipped for pictures, encodes it to PNG, loaded lazily like the engine.

## 5 Owners and boundaries

- `@runlith/agent-tools` — `read` and a new `pdf.ts` owning the engine, the page window and the rendering; dependencies on `@embedpdf/pdfium` and `sharp`.
- The kernel, the keeper, the wire and the chat are unchanged: a scanned page is an ordinary picture.

## 6 Rejected alternatives

- **Native `document` blocks**: one wire of six carries them; the others would need adapter work and still fail on Bedrock.
- **pdf.js**: text is pure JavaScript, but rendering needs a canvas binding (another native module per platform).
- **MuPDF**: AGPL-3.0.
- **poppler command-line tools**: absent from most machines Tagma will reach, and a process per page.

## 7 Acceptance criteria

- `read` of a text PDF answers page-marked text and the page count; `pages: "2"` answers page 2 alone.
- A 100-page PDF answers its first window and names the `pages` value that continues.
- A scanned page reaches the model as a picture; a sixth scanned page in one window is named, not rendered.
- `pages` on a text file is refused; an encrypted or broken PDF answers a sentence and the call is not failed.
- A process that reads no PDF loads neither the engine nor sharp from this module.

## 8 Claims and tasks touched

[[4f7ca8f4]] loses its PDF clause and is rewritten from the code; new claims for the PDF window, scans as pictures and the engine's lifetime. [[6905b907]] (each paging control refused on the wrong branch) is revised for `pages`.

## 9 Order of building

One task: the engine and text window, scans as pictures, the `pages` argument and the description.

## 10 Contract

`read`'s input gains an optional `pages` string; existing calls are unchanged.

out: 11 Stored data — nothing is stored beyond pictures, which take the existing road.

out: 12 Who may do what — `read`'s path admission is unchanged.

## 13 Long-lived things

One engine instance per process, created at the first PDF and never torn down; every document handle and buffer is released in the same call, on success, refusal or abort.

## 14 Bounded resources

The WebAssembly heap holds one document (≤ 64 MB) and one page bitmap at a time (at most 2000×2000×4 bytes); a call renders at most 5 pages and answers at most 50 KB of text.

## 15 Rollout

The next run reads the new description and argument; nothing running changes.

## 16 Failures

An engine that cannot load answers a sentence naming it; a stop between pages ends the call with what was answered so far discarded, as any stopped read.

## 17 Observability

The read row names the page count and window as facts and shows the scanned pages as thumbnails.

## Divergences as built

- **PDFium runs on a worker, not the server's loop (§4.1, §13).** Parsing, text and rendering are synchronous WebAssembly calls that would stall every request; one worker per process takes one document at a time, and sharp encodes the pixels on the main side. The file's bytes are transferred to the worker, copied into the WebAssembly heap and let go.
- **The worker ends after a read that grew its heap (§13).** WebAssembly memory never shrinks — 17.75 MB at start on this machine, one sample — so a worker whose heap grew is terminated once idle and the next PDF starts a fresh one; a worker still at its starting heap is kept. A failed engine load is not cached.
- **§14 counted one copy of the document.** At peak a read holds the document in the heap, PDFium's parsed objects (bounded by the PDF, not its size), and up to five 2000-px RGBA pages until they are encoded; the transferred file is freed once copied in.
- **Text is extracted only up to what the answer can hold,** and every page is charged a frame for its marker and note, so a window never outgrows the tool-output envelope and keeps its continuation.
- **A page is answered in one of six states:** text, cut (the first page of a window past the cap, marked in its note and in the footer), shown as a picture, deferred past the five-picture cap, undrawn (its bitmap or its PNG could not be made), or unreadable (PDFium cannot load it) — a page PDFium cannot load is no longer drawn as a blank scan.
- **A PDF is recognized by `%PDF-` within its first 1024 bytes,** as the format allows, and before read's generic 200 MB refusal, so any PDF past 64 MB answers a sentence. `offset`, `limit` and `cursor` on a PDF are refused, naming `pages`.
- **Pages are encoded as RGB PNGs,** the alpha channel being always opaque; line breaks are normalized to `\n`.
- **The release closure carries `@embedpdf/pdfium` as a module** left external to every bundle and probed to load, and `bin/server/pdf.worker.ts` as an entry of its own beside the server entry, which resolves it by its own address.
