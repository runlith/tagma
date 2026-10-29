---
id: 01a0c83e-720c-79f3-8f2a-51423fd796be
title: Build the zone for the failures a provider call can end in
ord: 97
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c84e-da06-78e8-9af9-51241fcb4003",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/provider-error.ts
  - kind: file
    ref: packages/llm/src/llm/schema/errors.ts
---
Write the claims of [[0e9e68a2]] from `packages/llm/src/llm/schema/errors.ts` and `packages/llm/src/llm/provider-error.ts`. Parent [[249ce587]], reference shape [[6c81c6f3]]. What a caller may match on, which reasons are the vendor's word and which this package's own reading, and what a family being retryable does and does not establish.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.