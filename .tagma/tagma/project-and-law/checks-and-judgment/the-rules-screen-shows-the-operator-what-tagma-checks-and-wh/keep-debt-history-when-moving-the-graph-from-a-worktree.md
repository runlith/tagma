---
id: 01a1659e-15ac-7752-ad85-d2e178001b26
title: Keep debt history when moving the graph from a worktree
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1659d-5507-72ba-8942-909a1b4144fe",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1659d-5486-77d4-9ad6-d044fe823ee5
---
Fix the loss of a worktree-accepted debt change after merge_worktree and the changing numbers of former marks. By the code, history is restored from the mirror's local journal, while the merge carries the enforcement document without the journal; the remeasure back-calculation starts from the new current counter. Verify the public scenario thread → worktree → enforce_rule absorb checkout WT → submit_work → merge_worktree → read_enforcement main.
