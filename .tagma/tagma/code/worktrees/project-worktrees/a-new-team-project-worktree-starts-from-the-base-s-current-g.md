---
id: 01a13fc0-eed3-72ea-84e6-1fcc4711acec
title: "A new team-project worktree starts from the base's current graph: base moves to the delivered graph only through graph-only commits"
ord: 10
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/creation/execute.ts
    symbol: makeWorktreeCreator
---
A prepared base pins the approved code, but main's graph moves every minute: a task created between prepare and create would otherwise be invisible in the branch. So before reserve, create delivers the base checkout's graph via `graph.commit` and moves base to its HEAD when base is an ancestor of HEAD and only the graph changed between them (`inGraphTree`). The branch's code stays approved, and the branch gets the graph through commits — with shared history, so a task changed in the branch merges back without the add/add conflict that copying uncommitted `.tagma` files would have produced.

With `graph.commit = off` Tagma never commits the graph: creation starts from the prepared base, and `evidence.graphLeft` names the checkout and the count of left-behind uncommitted graph files — the operator sees what the branch missed. An existing branch is untouched: its base is its own tip.
