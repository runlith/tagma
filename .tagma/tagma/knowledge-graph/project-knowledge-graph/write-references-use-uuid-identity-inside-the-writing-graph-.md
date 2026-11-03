---
id: 01a18a4f-0126-7fb5-8206-75e4231727b7
title: Write references use UUID identity inside the writing graph copy
ord: 255
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: localId
---
Mirror row numbers are local to a graph copy. A name found in another copy cannot supply a parent or edge row number to the current writer: its UUID is resolved again in the writing copy, and an absent peer refuses before mutation so an unrelated row with the same number is never used. That refusal names the copy that holds the block and the way to carry it into the writing one, since searching cannot find what only another copy holds: a reflection answered in main by work finished on a branch waits for `merge_worktree`.