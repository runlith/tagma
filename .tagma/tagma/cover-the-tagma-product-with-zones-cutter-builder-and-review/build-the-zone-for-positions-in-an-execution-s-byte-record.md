---
id: 01a0c6f2-a7cd-740e-8c20-99b9f7d8ca79
title: Build the zone for positions in an execution's byte record
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-4417-7c42-8fcd-8f345d493f88",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/record.ts
---
Write the claims of [[be8c3c5f]] from `packages/executions/src/protocol/record.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The on-disk layout these positions address is [[80c54f42]] and belongs to that task.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.