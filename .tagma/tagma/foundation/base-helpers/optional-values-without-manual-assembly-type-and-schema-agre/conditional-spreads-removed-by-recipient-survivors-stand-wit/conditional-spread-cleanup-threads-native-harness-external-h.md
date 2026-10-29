---
id: 01a12812-89b3-78cf-8d61-fdf5f249a450
title: "Conditional spread cleanup: threads, native-harness, external-harnesses"
ord: 3
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
    ref: apps/tagma/server/src/external-harnesses
  - kind: dir
    ref: apps/tagma/server/src/native-harness
  - kind: dir
    ref: apps/tagma/server/src/threads
---
The [[40ffd688|spec]] step-4 procedure over `apps/tagma/server/src/threads`, `native-harness`, `external-harnesses` — about 400 sites. Done when the `optional-spread` inspection over these areas finds only sites recorded as needed in the report, with a reason, and typecheck and tests are green.
