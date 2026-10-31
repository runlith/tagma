---
id: 01a0d3ce-367a-71ee-9a70-458e60b89043
title: A move of a running thread is denied `target-unrecorded` at its next step, while the listing already shows it in the new worktree
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d3aa-1104-7d42-b529-e2d199a2a0d5",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/targets/decide.ts
    symbol: ThreadTargets
---
Seen during the browser check of [[8c022144]], on a beside server built from the working tree at 90bbfd68a8 on 2026-09-24.

A child spawned over HTTP was running in worktree A. `move_thread` into worktree B answered `pending`. The kernel then settled the context change as `denied` with the detail: "target-unrecorded: Run 01a0d3c2-260f-… records generation 1, and no destination was recorded for it."

The selection had already moved: the listing named the thread in B, while its run kept working in A and nothing re-placed it.

[[7b6d8059]] promises that a running thread moves at its next step boundary. Done when a move of a running thread publishes at the next generation and its next command runs in the new worktree. A denied change should leave the selection where the run stands, or be reported as a failed move.