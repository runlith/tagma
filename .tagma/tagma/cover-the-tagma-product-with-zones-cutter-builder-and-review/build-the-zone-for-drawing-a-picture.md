---
id: 01a0c83e-7280-7e3e-a5a2-9b6e8b12ab7b
title: Build the zone for drawing a picture
ord: 114
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/llm/drawing
  - kind: file
    ref: packages/llm/src/models/draw.ts
---
Write the claims of [[b0fa2878]] from `packages/llm/src/llm/drawing` and `packages/llm/src/models/draw.ts`. Parent [[249ce587]], reference shape [[6c81c6f3]]. Why a drawing rides the one-shot transport rather than the streaming stack, and which media types a next model call can be handed unconverted.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.