---
id: 01a0e532-cc04-7929-bf6b-30de602b557d
title: "worktrees M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e9b8-65a8-70b0-bc74-beeda1d5a940",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-cbfc-7817-83e6-7d22191594cc
---
§7.2.2 milestone `M3` of the `worktrees` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

Divergence at finish (commit 924e563c32): worktrees holds no `modules`, `names` or `swallowed-failures` debt of its own. The zone is left for the merge, the `worktree_operation` → `worktree_intent` migration for the squash, both on [[4a9013bf]]. `FinishingGates` (`retirement/finishingGate.ts`) keeps its keyed semaphore map and fails `held-resources`. A `@runlith/held` hold cannot replace it: the archive commits through landing's `commitLane` under the root gate, and a merge runs hooks for longer than the 15-minute cap, so both would die with `WaitUnderHold` or be cut.