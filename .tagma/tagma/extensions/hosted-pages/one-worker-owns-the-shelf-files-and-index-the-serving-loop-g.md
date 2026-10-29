---
id: 01a15141-dca9-7f46-b4f9-ce1504a58d61
title: One worker owns the shelf files and index; the serving loop gets a bounded response
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/shelf.worker.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/storage.ts
---
Publishing, reading the shelf and team pages, recovery, and compaction all go through a single scoped worker: it preserves the journal order of sidecars and the current page, and version helpers never return to the server loop. The response payload is bounded by the requested page size; the single HTML stays a separate read. Team pages are selected top-k without sorting the whole sample, and page-to-thread membership is kept in the existing files. Compaction after a completed publish serves the index: its failure is reported as a warning and does not cancel the already published page; the next access restores the index.
