---
id: 01a0c83e-7237-7427-9100-96f0722f5e42
title: Build the zone for what every protocol adapter shares
ord: 103
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c853-2b86-79ed-942b-be64c141610e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/llm/protocols/utils
  - kind: file
    ref: packages/llm/src/llm/protocols/shared.ts
---
Write the claims of [[6ccf80ec]] from `packages/llm/src/llm/protocols/shared.ts` and `packages/llm/src/llm/protocols/utils`. Parent [[249ce587]], reference shape [[6c81c6f3]]. Build this before the individual wires: what a tool schema loses on the way to a vendor, how a streamed tool call is reassembled, and what a failure report is allowed to contain.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.