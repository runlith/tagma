---
id: 01a18e76-389d-7ec4-a97d-113c2e4a0df6
title: protocolRoad tests count only their own thread's run endings
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d5f-d1a2-7ec4-8e80-38ffb97302f1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18e32-4bbd-7a2a-9161-3ca007a3650c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/protocolRoad.itest.ts
---
The protocol rig shares one world across the file, and a floor reports every thread's run ending into the array a test passes. The unnegotiated-capability test leaves its devin thread with words that never reached the agent; by the product's contract they still wait, so every later floor's `recoverNow` relaunches that thread with the shipped profile and its ending lands in the next test's array. "another build" then read its report before `session/resume` arrived, and "a move mid-turn" counted a foreign answer as its own (seed 1: 15 pass, 2 fail; the pair alone failed 5 of 6 inline runs). The tests now count only endings of their own thread.