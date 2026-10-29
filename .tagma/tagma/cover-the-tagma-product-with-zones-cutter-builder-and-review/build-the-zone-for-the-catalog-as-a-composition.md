---
id: 01a0c83e-726c-7802-a6a5-6aea45d5a328
title: Build the zone for the catalog as a composition
ord: 111
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c855-eba2-7509-85b7-3c8c974ee2da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/models/catalog.ts
  - kind: file
    ref: packages/llm/src/models/description.ts
  - kind: file
    ref: packages/llm/src/models/resolve.ts
---
Write the claims of [[73301858]] from those three files. Parent [[249ce587]], reference shape [[6c81c6f3]]. The default set this package ships is one composition and not the mechanism: what a stored or wire provider string resolves against, and what a selection naming a model the composed catalog does not carry does.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.