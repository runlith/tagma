---
id: 01a14a48-802d-7d91-b6fd-0c733d6befd7
title: A stopped queued merge keeps showing "conflicts on …" after the conflicts are resolved and the merge check is clean
ord: 22
tags: ["reflection"]
fields:
  {
    "actual": "The panel shows \"Merges cleanly into main\" and \"The merge waiting for main stopped — merging into main conflicts on <3 graph files>\" at once, though those conflicts are already resolved by commit ca19412790; the operator read it as an unfinished merge and a bug",
    "command": "The oxlint-unbound-method worktree panel (list_worktrees → row.pending) after merging main into the branch and commit ca19412790",
    "expected": "When a queued merge's stop reason is gone (check went clean), the pending row clears itself or moves to \"can land\"; the panel does not contradict itself"
  }
---
Filed from project `runlith`.

The queued merge stood since October 15 (1248 base-staged attempts). After the staged file's commit into main, its next attempt met merge-conflicts and stopped — under the merge_worktree contract the pending entry stands until cancel_worktree_merge, a successful merge, or the worktree's deletion clears it. The conflicts were then resolved on the branch, check_worktree_merge answers clean, but the pending with the stale reason stays and demands a manual Dismiss or a new merge.
