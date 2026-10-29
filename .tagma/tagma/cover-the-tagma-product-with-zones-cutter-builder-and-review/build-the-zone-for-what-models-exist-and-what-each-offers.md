---
id: 01a0c83e-7266-7143-bf86-d3c27d1e977a
title: Build the zone for what models exist and what each offers
ord: 110
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c843-4a7f-71d1-a051-f24a82e9589f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/models
---
Write the claims of [[b8e8a877]] from `packages/llm/src/models` — the per-provider description tables and the sign-in status a picker reads; its children [[73301858]], [[0e5a78c1]] and [[b1b7c13d]] own the catalog mechanism, the images and the cache curve. Parent [[249ce587]], reference shape [[6c81c6f3]]. Browser safety is the boundary this area lives under, and [[0ae02efb]] already states it at the module — claim instead what a description may and may not declare, and what a switch value means to the layers that carry it without reading it.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.