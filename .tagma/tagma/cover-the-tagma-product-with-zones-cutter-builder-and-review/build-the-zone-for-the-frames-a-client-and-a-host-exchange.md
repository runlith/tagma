---
id: 01a0c6f2-a892-7462-aa91-d6f7e0a527cb
title: Build the zone for the frames a client and a host exchange
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c70a-1353-7807-b5cf-a6fdcd5e7bc2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
---
Write the claims of [[6daec65b]] from `packages/executions/src/protocol/wire.ts` — the largest file in the vocabulary at 933 lines, and the one every verb crosses. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The client side of these frames is [[e3a0cae2]] and [[fb25686f]]; read them and leave their claims to their own tasks.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.