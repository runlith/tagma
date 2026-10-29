---
id: 01a14c13-c481-7acc-8aa6-03ce4ddaf40d
title: Updating a worktree from the base is entrusted to its leading thread
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/updateWorktree.ts
  - kind: file
    ref: apps/tagma/server/src/threads/worktreeUpdates.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/updateWorktree.ts
    symbol: UPDATE_WORKTREE_OPERATIONS
---
**Value.** A lagging or conflicting branch is brought to the base by the agent that knows its work — resolving conflicts in files and with its own checks, not a blind merge.

**How.** Update from base on the board, in the row menu, and in the completion strip; the `update_worktree` operation.

**Behaviour.**
- The leading thread is the worktree's earliest thread whose parent doesn't stand there; if none, the act births a thread in the worktree.
- The thread gets the request to merge the base branch and resolve conflicts: a task with an answer owed when a thread calls, or a message when the operator calls.
- The act itself merges nothing.

**Limits.** If thread birth is refused, the act refuses too, with the birth refusal's exit.
