---
id: 01a0c6f2-a8e4-794e-9ce0-fd4735c52d92
title: Build the zone for the on-disk shape of an execution's byte record
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c710-7765-76a7-bd8b-ff02e0dc6aeb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/recordFormat.ts
---
Write the claims of [[80c54f42]] from `packages/executions/src/recordFormat.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The positions this layout addresses are [[be8c3c5f]]; its reader is [[b87f70d3]].

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.