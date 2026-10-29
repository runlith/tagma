---
id: 01a17b46-3468-743a-b806-e20b1e3323ae
title: "Graph and installation tests wait idly: remove the waiting at the owner"
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b4d-13ec-7b8e-b567-7bf30b8785df",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
On the same 8-worker run. This area's files and their in-body waiting: `graph/serving/storageById` 12 s, `graph/serving/copies` 12 s, `installation/cut/dmg` 11 s (CPU 0.2 s), `graph/tree/mirror` 10 s, `installation/cut/release` 10 s, `graph/idleCopies` 10 s, `graph/tree/commits` 10 s. Plus world assembly: 638 s wall at 386 s CPU over the whole set. Find what they wait on, and remove it at the owner.
