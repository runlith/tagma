---
id: 01a0ca97-139e-7901-9139-7310c52434fd
title: Write the claims of the law of work, and of the batch that lands a corpus at once
ord: 202
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9d-3ec9-7983-8eb0-813248b75f95",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/work
  - kind: file
    ref: apps/tagma/server/src/graph/work/batchFiles.ts
---
Read `graph/work/` whole — Tasks, Standing, lifecycle, retirement, Review, Amendments, Reflection, Batch — and `graph/core/BatchSources.ts`.

Write the claims of [[3ce532a9]] and [[85d8c4b8]]: which transitions exist and who owns each, what a gate refuses and with what contract, what a status field written by hand would bypass, how a proposal's deferred operations are bounded to the subtree they amend, what a review may and may not decide about its own finding, and what a batch resolves inside itself rather than by name.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].