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
Fix transition publication losing schema-backed values when it copies committed thread metadata. Prove that a running thread's context measurement crosses thread.subscribe, with the regression failing before the producer fix; retain exact snapshot revisions and incremental publication.