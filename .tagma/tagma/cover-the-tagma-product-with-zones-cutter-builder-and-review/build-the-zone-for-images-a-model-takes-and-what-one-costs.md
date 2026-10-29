---
id: 01a0c83e-7273-7047-a225-1b829670fe88
title: Build the zone for images a model takes, and what one costs
ord: 112
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c883-7a77-70bd-a2ff-e41a79610169",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/models/imageTokens.ts
  - kind: file
    ref: packages/llm/src/models/normalizeModelImage.ts
---
Write the claims of [[0e5a78c1]] from those two files. Parent [[249ce587]], reference shape [[6c81c6f3]]. The four ceilings are declared in the file as inherited and unmeasured — record that as the limitation it is rather than supplying a reason the evidence does not give, and state which rejections are refusals and which are re-encodings.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.