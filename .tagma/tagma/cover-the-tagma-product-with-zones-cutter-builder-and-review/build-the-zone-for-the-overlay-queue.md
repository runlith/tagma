---
id: 01a0c83d-a8f7-73a5-b243-ee70026e29b7
title: Build the zone for the overlay queue
ord: 80
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c841-47d5-7e59-9bc8-7d8a9128b452",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/primitives/src/overlay-plan.ts
  - kind: file
    ref: packages/primitives/src/OverlayQueue.svelte.ts
---
Fill [[0886e86e]] with the claims its code establishes. Read `src/OverlayQueue.svelte.ts` and `src/overlay-plan.ts` whole, with `src/OverlayQueue.test.ts` and `src/overlay-plan.test.ts`; the policy vocabulary and `relate` belong to [[cea5253f]] and the two promises to [[e5f2057d]], so claim neither. Watch: the two reactive signals the queue keeps and why a reader outside it must not wake on the one the pass writes; why `open` and `close` untrack at the queue's own door rather than leaving it to the caller; what the planner's three memories each mean and what clears each — `steppedAside`, `promotingId`, `cooling` — and the livelock each one prevents; why an outro in flight is a barrier to any promotion; why a request is forgotten by identity and never by id; how a cooldown is armed without a moment and booked to one later; and what the turn bound on the promotion loop is honestly worth. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]].