---
id: 01a12cc6-5156-7303-a8ac-4ae5d8ea5569
title: submit_work completes the resolved merge of the checkout tree
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c8a-a6f5-7ca4-8351-a0667bda6f35",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12976-4626-72c0-8eed-74db54f35a0e
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/landing/submitMerge.itest.ts
---
Complete an open git merge through submit_work: keep parents, incoming changes, conflict resolutions, and the session's ordinary landing; judge the merged tree and clear MERGE_HEAD after landing. Unresolved conflicts yield a typed refusal with paths. Start at prepared/change and landing/land; proof is a red→green contract test, independent review, and a commit. Update the operation description and answer the linked reflections.
