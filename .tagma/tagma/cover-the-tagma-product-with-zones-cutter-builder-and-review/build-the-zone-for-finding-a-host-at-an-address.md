---
id: 01a0c6f2-a8c1-7f3d-816d-a1e02a638a71
title: Build the zone for finding a host at an address
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c70f-d7e9-7ff8-aa42-738f0395f724",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/hostAddress.ts
---
Write the claims of [[b73811bc]] from `packages/executions/src/hostAddress.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. Its parts [[f7491edf]] and [[f1ab74d9]] own their own files and have their own tasks.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.