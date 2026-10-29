---
id: 01a0c6f2-a830-7c00-aa60-ce73c4dd1a06
title: Build the zone for the bounded reading of the commands a host holds
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c708-c897-739f-9783-b960e9334590",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/inventory.ts
---
Write the claims of [[24e5dd81]] from `packages/executions/src/protocol/inventory.ts`. Parent [[dc8a87e1]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The execution listing it stands apart from is in [[d8b40238]].

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.