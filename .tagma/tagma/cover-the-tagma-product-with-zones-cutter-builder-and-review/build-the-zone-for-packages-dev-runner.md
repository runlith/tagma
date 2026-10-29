---
id: 01a0c830-caa0-7a68-bd95-9eb8adc260a4
title: Build the zone for packages/dev-runner
ord: 77
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1d0b-75a6-8d82-33f58155ebac",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/dev-runner
---
Wave 1, builder alone: `packages/dev-runner` (366 lines, 1 file) is a module by construction; depends on utils (built). The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.