---
id: 01a14a7c-3751-70ac-83b4-29d1f6ba4d41
title: A stopped merge-queue entry clears on its own once the branch or base leaves its refusal's tip pair
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a44-03fb-779e-bffe-120f45145bab",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14a48-802d-7d91-b6fd-0c733d6befd7
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/queue/pendingMerges.ts
---
A stopped merge-queue entry (`pending`, state `stopped`) stands on the worktree row until cancel_worktree_merge, a merge or worktree deletion drops it. Its refusal was carried at one tip pair — branch and base; after the branch or base moved on, the entry keeps showing the old refusal next to a fresh check ("Merges cleanly" and "merge … stopped — conflicts" at once), and only a manual Dismiss can drop it.

Do: the stopped entry remembers the tip pair it stopped at, and the queue itself drops it as soon as the branch or base leaves that pair; the entry's watcher doesn't end at the stop, listens to the base checkout and the worktree's own checkout, and a resume after restart re-judges stopped entries too.

Start from `landing/queue/pendingMerges.ts` (`retried`, `watch`, `resume`) and `landing/store/pendingMerges.ts`.

Proof: a stest in `WorktreeFinishing.stest.ts` — a request stopped on merge-conflicts vanishes from `ofProject` after the base is merged into the branch, with no cancel; red before the change, green after.
