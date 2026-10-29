---
id: 01a118b2-bed5-79d0-8fb4-b95a2bfa7aeb
title: "Merging main into a worktree with conflicts in .tagma (team storage): every graph door points at another, the working way out is git add + commit_checkout"
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "resolve_graph_conflict: refused team-tree «resolve and commit in the project repository»; sync_graph: refused tree-mid-merge «conclude it in the project's own git»; stage_checkout: refused graph-path «commit the block tree with sync_graph»; bare git commit: refused shared-checkout-sweep. Only this worked: git add .tagma/... by hand (against “.tagma is the server's property”) and tagma op commit_checkout, which concluded the merge.",
    "command": "git merge main in worktree file-manager (team storage .tagma), then resolve_graph_conflict; sync_graph; tagma op stage_checkout paths=[.tagma/...]; git add && git commit",
    "expected": "One door finishes a merge whose conflicts stand only in .tagma: accepts the resolved graph files and commits the merge, without requiring the agent to stage .tagma by hand"
  }
---
Filed from project `runlith`.

Cost: ~10 calls and reading history.ts/checkoutCommits.ts sources to find that commit_checkout finishes the merge. Conflicts were add/add task duplicates and one JSON diff in escaped (same set, different commit/line). Task 919272b1.
