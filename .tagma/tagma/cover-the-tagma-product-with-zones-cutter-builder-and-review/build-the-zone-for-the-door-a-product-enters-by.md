---
id: 01a0c83e-7287-7d7b-ac5f-1da6d68af54a
title: Build the zone for the door a product enters by
ord: 115
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c887-c756-7c68-ac49-28b690a09525",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/call.ts
  - kind: file
    ref: packages/llm/src/models/client.ts
---
Write the claims of [[c91bac0c]] from those three files. Parent [[249ce587]], reference shape [[6c81c6f3]]. What the `LLM` namespace normalizes and what it refuses, and what a product must supply to open a client — [[0ae02efb]] and [[5f9a6f6b]] already state the door's boundary at the module, so claim the contract, not the export list.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.