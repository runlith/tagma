---
id: 01a0c6f2-a8a5-77df-8214-e05cda403836
title: Build the zone for the client that fills the port over a host's socket
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c70a-71c8-7638-a136-2d24b4089c76",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/ExecutionClient.ts
---
Write the claims of [[ca298040]] from `packages/executions/src/ExecutionClient.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. Its parts [[e3a0cae2]] and [[fb25686f]] own their own files and have their own tasks; the port it implements is [[1e4f52e0]].

Reconnection replaying nothing is the load-bearing claim here: check what the code establishes about a lost reply, not what a caller might hope. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.