---
id: 01a12754-6b19-7b51-b05d-d2e9153018fe
title: "A pool contested by repeated takes issues permits in arrival order: Effect Semaphore hands the freed permit to the one that just took it"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: file
    ref: packages/held/src/Permits.ts
---
Effect `Semaphore` wakes waiters with a deferred task, while the fiber that released a permit immediately takes it again synchronously and gets there first. When the pool is shared by chains that immediately ask for the next permit, the waiter gets nothing at all: measured `[again, waiter]` with one permit.

That is how `list_worktrees` and `read_checkout` hung. All of the server's checkout-state reads share three permits, and each read takes a permit twice in a row: for the tree and for the comparison with the database. Checkouts that agents keep editing without pause are re-read in a loop, while a cold checkout waited minutes. A waiting read never completes and never reaches telemetry.

`Permits` hands the freed permit to the queue head in the same synchronous operation, and a new request bypasses the queue only when it is empty. Waiting for a permit shows as `queue.ms` on `CheckoutStatus.reading`.
