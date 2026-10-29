---
id: 01a0ca95-3124-7c04-bd37-2608ad0751d2
title: Write the claims of the project's threads and the list that shows them
ord: 192
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[2028d329]], about 3,400 lines over twenty-two files.

Read every file the area sources, whole. Its tests are the richest in the module — `ThreadList` alone has four test files covering order, pinning and acts — and they pin behaviour the components do not state. Load the `svelte5` skill first.

The subject is which threads a project holds and how the reader navigates them: the tree and its folds, what a row says about a thread that is running, resting or archived, what may be done to one without opening it, and the live feed with its coalesced window reads that keeps the list true while agents work. What a conversation DOES is [[aeb922f0]] and another task's.

The module above is [[cc59eadf]]; the agent kernel whose threads these are is [[d1caad35]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over these paths is clean, and a review passes.