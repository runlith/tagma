---
id: 01a0c6f2-a7ae-73f8-b059-5e75b5ec6a0b
title: Build the zone for the accepted launch
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-4012-7629-af2c-e59f2b5093ce",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/launch.ts
---
Write the claims of [[9f386482]] from `packages/executions/src/protocol/launch.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. What a launch resolves its environment through is [[d1324b4c]] and belongs to that task.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.