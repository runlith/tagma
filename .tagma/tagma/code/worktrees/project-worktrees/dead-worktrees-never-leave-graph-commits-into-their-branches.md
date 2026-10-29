---
id: 01a1361b-d394-7b90-ba36-3c7715dbae81
title: "Dead worktrees never leave: graph commits into their branches reset idleness, and archiving optional-fields left it registered"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13620-38ed-786c-8629-dfdc6e7a44e0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13616-a718-7223-86c3-78cd69b7211d
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/commits.ts
---
Two dead runlith worktrees stay alive, and cleanup never proposes them. Measured 2026-10-13 16:32 UTC:

- `optional-fields`: 0 flows, last movement 2026-10-10, 1236 commits behind main. On October 11 it was archived — the branch holds commit `3663804081` "the work left uncommitted when the worktree was archived" — but the folder and registration remain: `list_worktrees` shows it as an ordinary worktree with `conflicts` status.
- `tagma-holder-impl-f0e304`: 62 standing flows, all finished, last movement 2026-10-11, 767 commits behind main.
- Today at 15:59 UTC Tagma committed `tagma: graph @ 198` and `tagma: graph @ 746` into both dead branches (`graph/tree/commits.ts`). That commit resets the idle sign, so `list_worktree_cleanup` with even `idleAfterDays: 1` finds no candidate.

Cost: both worktrees get a merge check on every main movement ([[0d2fb993|merge check]]) and graph writes, though nobody works in them.

What to do:
- the graph commit never goes to a worktree branch nobody works in, and never counts as idle movement;
- archiving runs to the end — folder and registration leave — or refuses with a reason instead of leaving a worktree half alive; find out what happened to `optional-fields` on October 11;
- a worktree with no working flows and no own commits over the idle period becomes a cleanup candidate.

Proof: a worktree with no movement for N days with a graph commit inside the period is an `idle` candidate; interrupted or failed archiving never leaves a registered worktree without an answer about the cause.
