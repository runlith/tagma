---
id: 01a12ce2-c4a5-7b2d-b205-752a6fa15c9c
title: A session's selected regions overlay the merge index along line boundaries
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12cc6-5156-7303-a8ac-4ae5d8ea5569
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/overlay.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/overlay.ts
---
A session's selected regions overlay the merge index along line boundaries.

The index can hold a resolution that no longer stands in the working file. Git's side preference picks a whole hunk and loses the neighbouring resolution, so the producer only carries the selected regions: unchanged lines come from the index. A selected deletion of a HEAD line already replaced in the index does not delete the indexed replacement when it still stands in the working file; selected insertions in the same region keep their working-file order beside it. If a deletion overlaps an indexed replacement changed again in the working file, its removal cannot be attributed from the alignments and the landing refuses rather than guessing. Inside a replacement with equal line counts the position is preserved; an ambiguous boundary yields walk-cut with the path and a way out through whole or by resolving the working file against the index. Alignment runs in one scoped worker, one file per message, so CPU and memory never grow with the whole corpus on the event loop.
