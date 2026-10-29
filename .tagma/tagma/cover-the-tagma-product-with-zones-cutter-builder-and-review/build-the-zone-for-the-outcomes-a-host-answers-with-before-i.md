---
id: 01a0c6f2-a7a6-7f95-aa79-7ecd62769015
title: Build the zone for the outcomes a host answers with before it acts
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-3f78-7e80-8ca8-30ec110b384e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/host.ts
---
Write the claims of [[34d59fca]] from `packages/executions/src/protocol/host.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The port [[1e4f52e0]] states how these arms reach a caller; read it, and leave its claims to its own task.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.