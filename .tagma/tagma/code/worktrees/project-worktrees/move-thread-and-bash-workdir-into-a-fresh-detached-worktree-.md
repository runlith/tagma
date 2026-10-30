---
id: 01a18e1e-4f21-7d47-a722-39c898556b1a
title: move_thread and bash workdir into a fresh detached worktree fail with graph-pool server-fault
ord: 33
tags: ["reflection"]
fields:
  {
    "actual": "Both refused[server-fault]: graph-pool: a graph being brought to its checkout format reaches no other graph (unblock: Tagma defect).",
    "command": "create_worktree (detached f38b881c, root 01a18e1d-a7de-71c1-a636-3c6c20f84be3) then move_thread worktree=<rootId>; then bash workdir=/Users/teunlao/.tagma-dev/worktrees/tagma/rig-history-f38b881c",
    "expected": "Thread moves into the new worktree; a command with that workdir runs there."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T12:29:55.740Z, from f9dfb4b9.