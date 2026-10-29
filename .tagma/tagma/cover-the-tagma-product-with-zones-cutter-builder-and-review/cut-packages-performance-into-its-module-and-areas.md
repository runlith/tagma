---
id: 01a0c830-ca8c-750d-bb62-a0c8846c96ff
title: Cut packages/performance into its module and areas
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1b09-7825-87cc-ab1838beb3de",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/performance
---
Wave 1, cutter: `packages/performance` (8,123 tracked non-test lines, 23 files) — the process's own telemetry, profiles and performance reads. Depends on executions and utils (both built). The cutter writes the module, its boundary claims, the `depends-on` edges and the areas, and opens one build task per area under this decision.