---
id: 01a0c73a-b40b-71cf-b041-66ebb2c9c593
title: Stop the evidence door waking a thread before every read
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/harness/rolloutDrill.itest.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/threadEvidence.ts
---
`ThreadEvidence.opened` still calls rehydrate ahead of every read, so the port implementations answer a rested thread from its file while the door above them has already woken it. The rollout drill is where this shows: its read half passes by asserting the rows came back and the stamp cleared.

Remove that rehydrate and let the implementations answer, then re-check the faces behind the door — query, pin and expand — because each was written against rows that were always there. The drill's read half states the old contract and moves with the change.

Done when a transcript read of a rested thread leaves its stamp standing and opens no write unit, measured at the door rather than at the implementation.