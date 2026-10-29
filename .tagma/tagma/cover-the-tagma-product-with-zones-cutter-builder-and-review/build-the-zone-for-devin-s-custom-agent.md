---
id: 01a0c83e-72ac-7315-bd80-d3c0ce130474
title: Build the zone for Devin's custom agent
ord: 120
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c886-1059-77c4-b298-e2c1458a18ff",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/adapter-devin/src/profiles/devin.ts
  - kind: file
    ref: packages/adapter-devin/src/profiles/devinCustomAgent.generated.ts
  - kind: file
    ref: packages/adapter-devin/src/profiles/DevinCustomTools.ts
  - kind: file
    ref: packages/llm/src/profiles/devinClient.generated.ts
---
Write the claims of [[bf5b1dbc]] from those four files. Parent [[249ce587]], reference shape [[6c81c6f3]]. What the custom tool surface obliges a caller to, and what the generated client identity is generated from.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.