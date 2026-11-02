---
id: 01a199a0-6a87-7eb1-8651-e537f94dc1d5
title: Keep typed metadata intact in committed thread changes
ord: 210
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1999d-41eb-74f7-a24e-3ba03d0227d9",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
---
Committed metadata now remains a typed in-process projection instead of losing schema-backed values in a JSON copy. The real WebSocket thread.subscribe regression failed before the fix with the reported LLM.Usage error and exact field path, then passed seeds 1–3; the server typecheck (including agent) and 23 targeted snapshot/transition cases passed. Commit: c859b5f4be.