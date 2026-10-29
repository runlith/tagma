---
id: 01a0d3e1-b222-7dba-a7ed-fbd1aacbc05a
title: The worktree listing names where every live thread stands, so no reader has to take absence from every row as main
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d3aa-1104-7d42-b529-e2d199a2a0d5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d3a8-f00c-7b9b-8939-8cf68c022144
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/rowReader.ts
---
Main's row lists only its working and waiting threads, while every other row lists all of its placings ([[4ee94b29]]). The app therefore reads absence from every non-main row as main ([[e9601381]]). A thread whose placing points at a root the listing no longer answers is drawn, chipped and followed as standing in main. The listing should answer every live thread's place, for example as a thread-to-root map beside the rows, bounded by the same page rules. The app then reads it instead of the fallback.