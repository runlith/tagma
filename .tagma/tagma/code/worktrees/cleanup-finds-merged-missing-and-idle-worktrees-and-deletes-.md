---
id: 01a14c13-c481-7acc-8aa6-03d12f8bdbf8
title: Cleanup finds merged, missing, and idle worktrees and deletes the selected in bulk
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d0ad0de7bf
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/Cleanup.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/CleanupDialog.svelte
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/cleanup.ts
---
**Value.** Piled-up worktrees are removed in one pass, and cleanup doesn't touch those with unfinished work left.

**How.** Clean up… on the board; the `list_worktree_cleanup` and `clean_up_worktrees` operations.

**Behaviour.**
- Candidates are only Tagma worktrees: merged, with a missing folder, and idle past the chosen threshold. Each has a cause and blockers: a working or waiting agent, uncommitted, commits on neither remote nor base, an unreadable branch, a pending merge.
- A commit whose every change lies in the graph tree (`.tagma`, not its `workflows`) is no movement and no unpushed work, whatever its subject; a commit touching code and the graph together is work.
- Cleanup re-judges each selected one and deletes the fit one by one, like deletion; the rest answer with their own refusal, and cleanup goes on.
- The board row itself offers to delete a worktree idle for several days.

**Limits.** Cleanup never starts on its own — only by the operator's or agent's act.
