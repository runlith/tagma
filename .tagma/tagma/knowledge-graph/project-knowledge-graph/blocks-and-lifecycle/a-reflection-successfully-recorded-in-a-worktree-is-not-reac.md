---
id: 01a12972-f63c-772f-b022-3fb30a92f166
title: A reflection successfully recorded in a worktree is not reachable by name from main
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "not-found: no block is named c94f3d86. The toolOutput of thread 01a12737-e764-7c36-a28a-eb0147556b78, at=5813, holds the successful creation of c94f3d86 under root 4d2ff254; text search does not find the block either.",
    "command": "read_block({project:\"runlith\",blockIds:[\"c94f3d86\"]})",
    "expected": "Read the reflection created by file_reflection in this project; the project's graph is shared across checkouts."
  }
---
Filed from project `runlith`.
