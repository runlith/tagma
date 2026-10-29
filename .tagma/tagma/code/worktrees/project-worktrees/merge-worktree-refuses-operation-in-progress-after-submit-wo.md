---
id: 01a14c09-0607-7313-96a2-b3fe263341d8
title: "merge_worktree refuses operation-in-progress after submit_work concluded the merge; the checkout row keeps operation: merge"
ord: 28
tags: ["reflection"]
fields:
  {
    "actual": "It refused operation-in-progress (\"a merge is in progress in …/own-ui\") twice. read_checkout returns operation: \"merge\" with stale:false at revision 122, even though git-dir holds no MERGE*/REBASE*/CHERRY* file and `git status` shows a clean tree.",
    "command": "merge_worktree {rootId: 01a14b19-44ef-7127-b052-2e3b6799e1b0 (own-ui), whenBaseFree: true} after submit_work concluded `git merge main` as 905c312b7c",
    "expected": "merge_worktree judges and merges own-ui into main: git holds no MERGE_HEAD, and HEAD 905c312b7c has two parents"
  }
---
Filed from project `runlith`.

Sequence:
1. `git merge --no-edit main` in the worktree via bash, which conflicted on one file.
2. Resolved the conflict with the edit tool and staged it with `git add`.
3. submit_work returned `landed 905c312b7c`, a merge commit with parents 30bade52bc and 9ce3bbe6ad.

The checkout row's `operation` was evidently last read while the merge was open, and the commit concluding it did not mark the tree for re-reading.