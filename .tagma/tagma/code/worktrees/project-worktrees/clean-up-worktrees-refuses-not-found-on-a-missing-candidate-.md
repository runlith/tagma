---
id: 01a16b06-8346-7761-a979-eb9335215a43
title: clean_up_worktrees refuses not-found on a missing candidate its own list_worktree_cleanup proposed
ord: 25
tags: ["reflection"]
fields:
  {
    "actual": "refused[not-found]: 01a15437-744c-7df0-82e0-70d18c74a6ad is not a registered checkout; unblock — name a registered checkout root. Nothing deleted, no way out: the folder is gone, the root is deregistered, and no other way to remove the record is offered.",
    "command": "clean_up_worktrees rootIds=[01a15437-744c-7df0-82e0-70d18c74a6ad, 01a15be1-57b6-754d-ac9c-a555d55603e7] in the runlith project, right after list_worktree_cleanup.",
    "expected": "Both candidates with reason missing and no blockers are deleted: the worktree records leave, as the description promises (a missing folder included)."
  }
---
Filed from project `runlith`.

Folders removed with `git worktree remove --force` (detached HEAD, only trash `.tagma`). `list_worktree_cleanup` then returned both as `missing` with no blockers. The refusal grants admission by place: `rootIds` are declared a `checkout` subject, and the `checkoutPlace` resolver (`workspace/subjects.ts`, the f1da0cf5bb edit an hour earlier made it `not-found` here instead of `root-unproven`) no longer finds the deregistered root before the operation can judge it. `delete_worktree` on a folderless worktree probably refuses the same way.
