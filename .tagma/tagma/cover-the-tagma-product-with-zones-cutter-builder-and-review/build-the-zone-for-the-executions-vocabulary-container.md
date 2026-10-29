---
id: 01a0c6f2-a79a-754b-a977-d258aa958cc2
title: Build the zone for the executions vocabulary container
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-3e86-7ef3-8cee-228d87ab7718",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/executions/src/protocol
---
Write the claims of [[fd73da27]] from `packages/executions/src/protocol` — what holds across the whole vocabulary rather than inside one of its parts: what the barrel carries, what every record is measured over, what none of them may reach. The sub-areas own their own files; do not write into them. The module is [[6c81c6f3]] and the reference shape is the Git kit [[adeeb4ba]].

Done when each claim is bound to the narrowest sources that can contradict it and verified after a reading of every one, the area body is qualified where a part of the vocabulary differs from it, `run_doctor` over these paths leaves nothing open, and a review passes.