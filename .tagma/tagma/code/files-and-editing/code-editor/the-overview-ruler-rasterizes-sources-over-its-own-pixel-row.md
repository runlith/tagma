---
id: 01a1182b-2b47-7719-a130-00d10dafd57b
title: The overview ruler rasterizes sources over its own pixel rows via lineBlockAtHeight — cost stays flat with mark count and holds under BigScaler
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-editor/src/extensions/ruler.ts
---
The ruler draws not marks but its own pixel rows: for ruler row y it takes the document stretch `lineBlockAtHeight(y / scale − documentPadding.top)`…`lineBlockAtHeight((y + 1) / scale − documentPadding.top)` and asks each source (`rulerSources` — the `RangeSet` of the diff, holder bands, search matches, conflict) whether it holds anything there. A full repaint costs ruler height × sources × O(log n), independent of mark count; an edit that changed no heights repaints only the pixel rows of the touched stretch; scrolling moves a single frame. Runs of identical pixels become one element, and the band DOM changes only when the runs change.

CodeMirror reports `lineBlockAtHeight`, `lineBlockAt` and `contentHeight` in DOM coordinates — via `BigScaler` for documents taller than ~7M px — so the height share stays correct even on a 100,000-line file; a line number divided by the line count would drift from the scroll where line heights differ (wrapping, diff widgets). Marks, the cursor and the viewport frame (`scrollTop / scrollHeight`) divide the ruler height by a single `scrollHeight`: a document shorter than the screen occupies the ruler's top, as its lines do on screen, instead of stretching over its full height, and the frame always stands over the visible lines. Search matches count up to 5,000; after an edit only touched lines rescan.
