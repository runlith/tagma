---
id: 01a0c6b3-0548-72c9-afaa-6f31208c5d66
title: Waking a rested thread must not hold the single writer for seconds
ord: 110
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/files/ThreadRolloutSync.ts
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadRollouts.ts
---
## Measured

Rehydration carries a whole rollout back in one transaction, deliberately, so nobody can meet a thread whose stamp says evicted beside records it says are gone. Measured on 2026-09-22 by evicting and waking the fifteen heaviest threads a seven-day window rests: the transaction held the server's single write permit for **0.4 to 15.6 seconds**, ten of the fifteen between 4 and 11 s, with the commit alone taking 1.2–4.5 s. The store's own instrument announced three of them as writer holds that every other writer waited on.

That cost was always in the code; resting threads by idleness is what makes it common, and it is the exact shape of stall this project spent a day removing elsewhere.

## Accepted

A wake's hold on the shared writer is bounded, and the bound is stated where the code takes it. What must not change to get there: a reader may never meet a half-woken thread — evicted stamp beside records that are neither gone nor whole is the thing the single unit exists to prevent.

The means are open and the choice belongs to whoever builds it. A third state that says a thread is waking, so records can land in bounded units while readers are told what is happening; serving a rested thread's transcript from its rollout without waking it at all; or a different placement for the carry. What is not open is quietly dropping the guarantee to make the number smaller.

## Acceptance

Waking the heaviest rested thread on a real store holds the writer no longer than the bound the change names; a reader arriving mid-wake meets a defined answer rather than a partial thread; and the measurement is repeated on the same material that produced 15.6 s, not on a fixture.