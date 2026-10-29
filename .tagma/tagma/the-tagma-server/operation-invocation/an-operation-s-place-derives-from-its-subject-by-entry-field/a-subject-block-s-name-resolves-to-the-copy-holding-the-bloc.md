---
id: 01a156ea-c610-782c-8954-90b22c8ed261
title: A subject block's name resolves to the copy holding the block, including another project's worktree
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1565c-47b9-7ff2-bfd3-246b13adade8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
  - kind: waits-on
    to: 01a156ea-c610-782c-8954-90b16bb9bbf2
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
`crossing.elsewhere` looks for someone else's block only in the main copy (`indexHolding` takes canonical lines), so a block existing only in worktree B cannot be found from A. Subject resolution for `block` and `locate` read one address answer from the name index (`titlesAcross`): the current copy, the rest of its project's copies, every machine project's copies, and global.

Proof: a system test — `read_block_log` of a block existing only in worktree B answers from that copy.
