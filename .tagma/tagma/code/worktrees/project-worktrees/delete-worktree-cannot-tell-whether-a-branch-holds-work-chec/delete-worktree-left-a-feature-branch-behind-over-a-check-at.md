---
id: 01a14f49-f129-74a1-8a7d-ce8a2b50f522
title: delete_worktree left a feature branch behind over a check-attr in .git
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "In 11 s the folder is deleted, nine threads handled; answer branch-kept: whether it holds work could not be read: fatal: this operation must be run in a work tree (-C <checkout>/.git ... check-attr -z --stdin merge).",
    "command": "tagma op delete_worktree --project <project> --yes --json '{\"rootId\":\"01a0f2fc-a237-7d4e-befa-4fae7f8b0382\"}'",
    "expected": "Delete the worktree and correctly decide whether to keep its branch for unclaimed work."
  }
---
Filed from project `runlith`.

A repeat of the same defect. The operator explicitly ordered the branch deleted together with the worktree. Before the call: a clean working tree, no git operations, six commits over origin/release, and HEAD matching the local origin/<branch> ref (13afdb219fc34709ad9869789b1e658d0419f593) were checked. To complete the ordered deletion the local branch has to be deleted with a separate git command; the existing remote-tracking ref keeps the commits.
