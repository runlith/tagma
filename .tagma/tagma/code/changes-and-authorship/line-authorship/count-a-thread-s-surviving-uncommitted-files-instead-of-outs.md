---
id: 01a0f7c6-597a-79d9-85e7-97131f27bfa6
title: Count a thread's surviving uncommitted files instead of outstanding change-record paths
ord: 87
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f7c3-e8cf-7ea5-b170-6dd232f51493",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/reads.ts
    symbol: heldPathCountsOf
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/write.ts
    symbol: ChangeLog
---
Correct the change-record producer of thread held-path counts so a fully reverted edit and another thread's surviving lines do not count as this thread's uncommitted files. Trace the sidebar and Changes projections, add a contract test through the count reader, preserve other sessions' writes, and document the measured contract under change-record. Acceptance: edit then revert yields zero; a shared path counts only for its surviving writer; existing ignored-file and outstanding-record contracts continue to hold.