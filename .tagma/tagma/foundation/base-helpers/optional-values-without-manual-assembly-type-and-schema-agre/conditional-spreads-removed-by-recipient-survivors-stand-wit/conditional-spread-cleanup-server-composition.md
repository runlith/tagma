---
id: 01a12812-89b3-78cf-8d61-fdf8715af9a9
title: "Conditional spread cleanup: server composition"
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition
---
The [[40ffd688|spec]] step-4 procedure over `apps/tagma/server/src/composition` — about 175 sites, over half in test rigs. Done when the `optional-spread` inspection over this area finds only recorded needed sites, and typecheck and tests are green.
