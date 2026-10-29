---
id: 01a1889e-da17-75b8-81a2-a163a920fd6d
title: "A read of an unloaded thread's rollout never shapes it: it opens the file and queues the shaping"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1889a-6037-78a2-8d09-8777b74bd780",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutForming.ts
---
`RestedRollouts` reads (`threads/journal/restedReads.ts`) call `RolloutForms.readable` and `formed`, which run `formRollout` whole inside the journal lane when the file is compressed, the thread has no form row, or a publication is pending — so a feed frame of an offloaded thread waits for its whole file to be shaped. The read gate keeps only what reading needs: the standing refusal and older-than-base checks, settling a publication a crash left unsettled (so the cursor matches the file before it is opened), and opening a compressed file. Shaping is queued through `formRested` and never awaited; decoding applies the steps meanwhile. Reconciliation at boot keeps its forming open (`formedOpen`).