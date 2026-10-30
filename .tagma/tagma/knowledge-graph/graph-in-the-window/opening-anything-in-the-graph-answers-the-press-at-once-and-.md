---
id: 01a14bf1-c8c1-7ce0-9d6e-628bc57e2aa9
title: Opening anything in the graph answers the press at once and shows contents in 50–100 ms; 1 second is the ideal ceiling
ord: 6
tags: ["rule"]
fields:
  {
    "delivery": "prompt"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/graph
  - kind: dir
    ref: apps/tagma/server/src/graph
---
Covers clicking a block, link or card and going to a block, including in another project's graph or in global. The interface reacts to the press immediately, even while data still loads. Longer than 1 second is allowed only for an objective reason that can't be removed (for example, a huge graph after a machine reboot); the reason is named in the spec or task.
