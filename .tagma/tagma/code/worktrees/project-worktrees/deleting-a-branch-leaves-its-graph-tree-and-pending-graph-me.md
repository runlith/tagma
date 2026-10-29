---
id: 01a130de-2cb8-7936-9c3c-fe7783a1d087
title: Deleting a branch leaves its graph tree and pending graph-merge recovery directory orphaned with no door to drop them
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "~/.tagma/<project>/recovery/5c410875-c135-4ed6-975f-46c4529d6997 (open merge, 3.2 MB) and ~/.tagma/<project>/trees/<branch>-1fc64082a33fabb2 (2.8 MB) remain; read_graph_recovery refuses no-checkout, so the pending recovery can no longer be read or resolved; list_worktree_cleanup/clean_up_worktrees cover code worktrees only. The only road left is rm -rf by hand.",
    "command": "delete_worktree rootId=01a11b34-395b-76a6-8ad3-7aabda754dec, then git branch -D <branch>; read_graph_recovery branch=<branch> project=<project>",
    "expected": "Removing the branch (or its worktree) retires its graph branch tree under ~/.tagma/<project>/trees and abandons any pending graph-merge recovery for it, or an operation exists to do so."
  }
---
Context: a graph merge between two feature branches conflicted because the two graph branches had been migrated by different Tagma format versions (graph:1/vocabulary:2 vs step measurements-leave). Both code branches were already fully merged into release, so the operator deleted them. The recovery the conflict notice asked for now has no owner and no way to be closed.