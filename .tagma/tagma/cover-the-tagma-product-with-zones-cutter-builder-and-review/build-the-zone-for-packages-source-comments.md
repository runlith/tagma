---
id: 01a0c6f6-d563-733d-9c7c-233a10ad347d
title: Build the zone for packages/source-comments
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6f7-8164-7248-9122-1208934d0739",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/source-comments
---
Wave 0, builder alone: `packages/source-comments` (650 lines) — the lexer behind `strip_comments` and `comments-standing`.