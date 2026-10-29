---
id: 01a180c0-3848-77f5-805f-e426e173fa8b
title: "Worktree deletion and cleanup recognize a graph commit by its content: every change lies in the graph tree"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a180c0-b2a9-7de0-b135-530166d72426",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
---
The recognition part of [[c11265c5]]: `GRAPH_COMMIT_PATTERN` leaves `worktrees/retirement`; a commit whose every change lies under `.tagma` is a graph commit whatever its subject or author, so old `tagma: graph @ N` commits need no separate branch, and a commit touching code and `.tagma` together is work.