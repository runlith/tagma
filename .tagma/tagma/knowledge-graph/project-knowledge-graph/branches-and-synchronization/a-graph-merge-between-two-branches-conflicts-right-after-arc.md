---
id: 01a17803-b09b-77d2-b4b8-11dee230663a
title: A graph merge between two branches conflicts right after archive_threads emptied the target worktree
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "A banner \"Graph changes could not be merged. feature-a → feature-b. 4 conflicted files. 1 other merges await recovery.\" appeared; read_graph_recovery shows recovery 1741f680-dcad-4ffa-ba0a-0bbb51231f79 created 11:27:43.286Z, between a refused archive at 11:27:40 and two successful ones at 11:27:45. Cause not established.",
    "command": "archive_threads {updatedSince: 2026-10-15T00:00:00Z, updatedBefore: 2026-10-19T11:20:05Z} at 2026-10-26T11:27:45Z in another project (archived thread 01a139b7-2d36-7dff-8dcb-9962e28f1704, which worked on branch `feature-b`)",
    "expected": "Archiving threads changes no graph: no graph merge starts and no recovery appears."
  }
---
Evidence: the sweeps at 11:27:45 and the refused call at 11:27:40 (read_thread entries, toolName archive_threads) bracket the recovery time. Worktree `feature-b` now has agents.standing 0 (list_worktrees); worktree `feature-a` still holds thread 01a1311a, whose archive refuses thread-tasks-unreadable because descendant 01a1313a holds tasks in removed project 32 (see 1ef4cac3). Conflicts: two block files, tags/rule.md, tags/software-development.md; base e715f09f, theirs 247fbfc9. Unverified: whether archiving the last thread of a worktree triggers the graph merge, and why the incoming branch is `feature-a` rather than a chain into release. Nobody ran a merge on purpose in this session.