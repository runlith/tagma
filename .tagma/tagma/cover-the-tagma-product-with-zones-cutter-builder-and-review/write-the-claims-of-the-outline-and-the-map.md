---
id: 01a0ca95-30fb-7668-847b-5b80ffaf5e69
title: Write the claims of the outline and the map
ord: 184
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Two sibling surfaces of the graph, grouped because neither reaches the other and both are read from the same root: [[f5df183b]] and [[6a2bb510]].

Read `apps/tagma/app/src/lib/features/graph/outline` and `apps/tagma/app/src/lib/features/graph/spatial` whole. `GraphView.svelte` is 914 lines and `graphsim.ts` holds the simulation — the layout arithmetic and what it is trying to keep true are the claims worth writing, not a walk through the loop. Load the `svelte5` skill first.

What both surfaces read stands in [[33ecfd33]] and is another task's to write; take it as given. The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over both paths is clean, and a review passes.