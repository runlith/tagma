---
id: 01a12995-4a3a-782f-b168-345d201bf57a
title: Tagma reflections live in the main-checkout graph regardless of the caller's worktree
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12994-dd53-7d37-acb1-f3fd3aa3dfe2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11971-8206-7b77-80c2-e5becead8015
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: reflectionPlace
---
Fix the operations-place choice for reflections: reading, writing, answering, and withdrawing an answer use the main-checkout graph of the project holding the running Tagma's sources. Start with reflectionPlace in graph/operations/crossing.ts; keep the sources-area choice and the caller's provenance. Contract tests with separate main and worktree graphs, checks within 3 minutes and three processes, independent review, and a landed commit prove completion. No separate migration of recorded reflections is needed.
