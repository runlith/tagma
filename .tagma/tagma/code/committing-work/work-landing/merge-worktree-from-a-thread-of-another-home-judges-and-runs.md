---
id: 01a15bb7-fcf0-784b-a8f4-59524d5c12f1
title: "`merge_worktree` from a thread of another home judges and runs checker programs in its home's scope: the queue and tail restore the caller with its home, not with the merge project"
ord: 130
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e24-f83e-7df8-a042-6ca95556e878",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15ba1-aa7b-74a8-925f-7d9827c7ba98
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/merge/tail.ts
  - kind: file
    ref: apps/tagma/server/src/landing/queue/pendingMerges.ts
---
`merge_worktree` stamps the caller with the call's project (`landing/operations/merge.ts`, `executionActorOf(caller.actor, call.project.id)`), stores only the Principal, while the queue (`landing/queue/pendingMerges.ts`, `attempt`) and tail (`landing/merge/tail.ts`) restore the actor via `actorOfPrincipal(principal, projectId)` with the merge project. A thread of home H merging a worktree of project P goes into tree judgement and `ProgramRoad` with scope P, and its checker refuses on the owner invariant ("ownership never moves work between projects") — the same defect 27c7ba98 closed for `check_rules`, `enforce_rule` and landings. Both merge passes (immediate and queue retry) and the tail after-checks must receive the thread with its home, plus a system test with a program inspection via `merge_worktree` from a thread of another home.
