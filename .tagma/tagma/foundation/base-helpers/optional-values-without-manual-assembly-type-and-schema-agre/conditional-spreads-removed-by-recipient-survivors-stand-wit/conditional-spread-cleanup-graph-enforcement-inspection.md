---
id: 01a12812-89b3-78cf-8d61-fdf9715ce079
title: "Conditional spread cleanup: graph, enforcement, inspection"
ord: 7
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
    ref: apps/tagma/inspection
  - kind: dir
    ref: apps/tagma/server/src/enforcement
  - kind: dir
    ref: apps/tagma/server/src/graph
---
The [[40ffd688|spec]] step-4 procedure over `apps/tagma/server/src/graph`, `apps/tagma/server/src/enforcement`, `apps/tagma/inspection` — about 310 sites. The `canonicalJson` input drops `undefined` on its own after its fix, so no spread is needed before it. Done when the `optional-spread` inspection over these areas finds only recorded needed sites, and typecheck and tests are green.
