---
id: 01a0c83e-7243-78da-bd40-439a624a8a4e
title: Build the zone for the Anthropic Messages wire
ord: 105
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c855-4c7f-76d1-9e09-205c073da82e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/protocols/anthropic-messages.ts
---
Write the claims of [[b17465d1]] from `packages/llm/src/llm/protocols/anthropic-messages.ts`. Parent [[249ce587]], reference shape [[6c81c6f3]]. Cache breakpoints, the thinking budget and its relation to the output limit, and which event shapes this decoder refuses.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.