---
id: 01a116e1-fd86-7f5b-a5b4-91e0d0051b98
title: Batch.held must not answer with an empty holder list when the batch document is unread
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a116c6-1f18-74ee-a89f-967c69003cc1
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/Batch.ts
    symbol: batchLayer
---
In `graph/work/Batch.ts`, `sourceOf` (line 356) turns any `documents.read(input.file)` failure into `null`, and `held` (line 360) answers `[]`. That reports "no holders" although the document's operations were never checked. The failure must survive as a typed refusal until the act over someone else's work is decided; a genuinely missing source/file stays a separate outcome. Start with the `Batch.held` contract and its callers in batch preparation: the error channel changes, not just the ternary. Done when a test through the batch-preparation owner shows a readable empty document with no holders and an unread document with a refusal, not an `[]` answer; the new refusal's code and consumers have landed.
