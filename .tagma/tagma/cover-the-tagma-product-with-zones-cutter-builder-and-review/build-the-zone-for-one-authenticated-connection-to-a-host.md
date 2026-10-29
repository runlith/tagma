---
id: 01a0c6f2-a8ab-76c3-be00-9a6735abaacc
title: Build the zone for one authenticated connection to a host
ord: 27
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
    ref: packages/executions/src/WireSession.ts
---
Write the claims of [[e3a0cae2]] from `packages/executions/src/WireSession.ts`. Parent [[ca298040]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The frames it reads and writes are [[6daec65b]]; the registration it reads a secret's location from is [[f7491edf]].

This file is one of the three that put the Bun platform in this package, which the module already claims; what this task owns is the handshake, the routing and what a closure does to everything waiting. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.