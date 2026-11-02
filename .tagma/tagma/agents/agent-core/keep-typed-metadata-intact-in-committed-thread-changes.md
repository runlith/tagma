---
id: 01a199a0-6a87-7eb1-8651-e537f94dc1d5
title: Keep typed metadata intact in committed thread changes
ord: 210
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1999d-41eb-74f7-a24e-3ba03d0227d9",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
---
Committed metadata remains a typed in-process projection, retaining schema-backed values. The real WebSocket thread.subscribe regression reproduced the reported LLM.Usage error and passed seeds 1–3 after c859b5f4be; server typecheck and 23 targeted snapshot/transition cases passed. The sole review identified that a whole reread could mask the WebSocket regression; ab90f8f99b adds a Usage-behavior assertion to the existing snapshot case that forbids rereads. It failed with the original producer (expected 1, received undefined), then agent typecheck passed and all 22 snapshot cases passed seeds 1–3 with the fix.