---
id: 01a14a94-9ad0-7ae1-8b5a-23bbe4c408f5
title: A stopped merge-queue entry clears once its refusal's ground moved, not just its tip
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a44-03fb-779e-bffe-120f45145bab",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14a7c-3751-70ac-83b4-29d1f6ba4d41
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/queue/pendingMerges.ts
---
After 2f0e8be832 a stopped merge-queue entry clears only once the branch or base tip moved, and only if the tip pair is recorded. Left hanging:
- entries with no pair — ones standing since the 20261017153306 migration, finishing-cut ones from recovery (`doubted` in `landing/merge/coordinator.ts`), entries whose tips couldn't be read at stop time;
- refusals whose cause is checkout state, not tips: `base-dirty`, `base-not-checked-out` (the base checkout), `source-held`, `source-dirty`, `operation-in-progress`, `no-branch` (the worktree checkout). Such a cause leaves with no tip move: commit/discard, abort of the operation, checkout of the branch.

Do: a stopped entry keeps the refusal's ground — the fingerprint of what that refusal depends on: the base and branch tips, and for checkout-state refusals the ref, operation and `status` writes of that checkout too. The queue drops the entry as soon as the ground changes. An entry with no ground is dropped at the first judgement where the ground reads. finishing-cut gains its ground at write time. The stopped entry's watcher listens to both checkouts' changes; the waiting entry still retries a merge only on tip move, base release and tick.

Proof: a stest in `WorktreeFinishing.stest.ts` — a request stopped on `operation-in-progress` clears after `git merge --abort` in the worktree with no tip move; a groundless entry clears on resume.
