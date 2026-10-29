---
id: 01a0c6f2-a89a-7712-a409-e0a2138909e3
title: Build the zone for the execution port
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c708-c741-7160-9054-ce0ce42dc65d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/Executions.ts
---
Write the claims of [[1e4f52e0]] from `packages/executions/src/Executions.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. How the port is bound is already claimed at the module; what this task owns is the port's own shape — its failure channel, what rides in an answer's union rather than in that channel, and what each verb grants and does not grant.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.