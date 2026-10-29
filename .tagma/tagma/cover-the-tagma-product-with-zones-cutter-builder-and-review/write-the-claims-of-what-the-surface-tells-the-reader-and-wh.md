---
id: 01a0ca95-30f5-7056-81d4-ace710f14459
title: Write the claims of what the surface tells the reader and what it remembers about them
ord: 182
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Two small adjacent areas, about 600 lines together: [[f8d4ce2b]] and [[0b3bddd7]].

Read `apps/tagma/app/src/lib/features/notices` and `apps/tagma/app/src/lib/features/reading` whole, with their tests. Load the `svelte5` skill first. The notices layer installs itself as the destination for unawaited failures, which is the claim worth the most here; the reading folder is five stores whose whole point is what survives a reload and at which scope.

Note for your reading, not for a claim: `NoticeCards.svelte` imports from the accounts folder, which the app's declared folder order forbids and its test currently reports as a fault. That is being tracked separately as [[7ea49bec]] — do not fix it, and do not write a claim that assumes it either way.

The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over both paths is clean, and a review passes.