---
id: 01a0c6f2-a8e9-7b29-b633-2830e44b99f2
title: Build the zone for reading a sealed record off a filesystem
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c710-7b54-741a-94cb-fbe27b315b04",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/RecordFiles.ts
---
Write the claims of [[b87f70d3]] from `packages/executions/src/RecordFiles.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The layout it reads is [[80c54f42]].

The seal as the only statement of completeness, and what each refusal does and does not prove about the bytes on disk, are the claims to get right. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.