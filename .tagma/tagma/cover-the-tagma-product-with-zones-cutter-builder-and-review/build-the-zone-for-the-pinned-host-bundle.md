---
id: 01a0c6f2-a8d6-7fa3-8c7d-a562217c7ee5
title: Build the zone for the pinned host bundle
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c716-e1b6-7b2e-a17e-17dbebf0c93f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/hostArtifacts.ts
---
Write the claims of [[677b406f]] from `packages/executions/src/hostArtifacts.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The manifest records it reads are [[cb53db9b]].

What verification proves and what it does not is the distinction this area exists for. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.