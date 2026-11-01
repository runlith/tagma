---
id: 01a19663-a80f-7e28-88e9-bce5fac23d10
title: A published merge is brought into the base checkout path by path, keeping only paths that hold uncommitted work
ord: 189
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34cd-7827-8f66-267225b84179",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19654-b900-7dd2-9ee1-92bd7f8ab4de
---
After publication, `merge_worktree` and the pull merge brought the checkout to the merge with a single `read-tree -m -u`. One path that another session rewrote after admission aborted it, and the index stayed on the old tree, staging a revert of the merge. Fixed in 3c8fdf87c8; the review findings are fixed in 10acce57fb.