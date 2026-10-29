---
id: 01a0c83e-7259-701b-bc6b-3f5c9d1c5ae6
title: Build the zone for the Gemini wire
ord: 108
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c883-772a-74b0-a3c9-9b46aa19d287",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/protocols/gemini.ts
---
Write the claims of [[351b9c2c]] from `packages/llm/src/llm/protocols/gemini.ts` and the Gemini tool-schema helper it reads. Parent [[249ce587]], reference shape [[6c81c6f3]]. What Gemini's own schema dialect cannot carry, and what this adapter does with a tool definition it cannot express.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.