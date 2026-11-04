---
id: 01a16a7f-1154-742c-a5ec-217ee20160c5
title: Worktree merge and deletion hold the graph copies they need until entering the worktree section
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/merge/integrate.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/pool.ts
    symbol: makeGraphPool
---
Sections `worktree-root` and `worktree-checkout` forbid waiting while held, and opening a graph copy waits for the openings lane's turn. When a copy opens inside a section, it either bypasses the lane and openings exceed its width, or waits holding the section. So merging holds the base's main copy, by which rules judge, the worktree's copy if the branch changed the graph since divergence, and the copy for pending-graph delivery before entering sections; deletion holds the delivery copy before its section. Inside sections the act finds these copies already open. A judging copy that could not open leaves the merge unjudged with that failure rather than reopening inside the section; pending-graph delivery still preserves its own recovery contract.

The worktree's copy is held only on the "branch changed the graph" condition. A branch created before the graph's appearance opens no copy of its own: a tree with no root block cannot open, and such a branch is judged by the base's graph.
