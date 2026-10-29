---
id: 01a14a84-f5ca-72b8-8ca5-dd99d442d640
title: "A reflection's name resolves from the Tagma sources' worktree: the name ladder reads the main checkout's graph"
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a55-73a4-7d5e-86a3-fb1085616c41",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
`file_reflection` writes the record into the source project's main checkout graph, while `read_block` of the same name from that project's worktree answered not-found: the name ladder skipped the "project sources" step when it matches the calling project, although the graph copy differs. That is how thread 01a1472e-06ee-7798-922b-8989326400fb missed c95002a5 that browser-desktop wrote.

Do: when the local search finds no name and the call stands in another checkout of the sources project, the ladder looks at the observation block in its main checkout's graph.

Proof: the system test reflectWorktree — a reflection filed from a worktree reads with `read_block` with the worktree cwd and from a thread in the worktree.
