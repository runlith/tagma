---
id: 01a174f2-3d5e-76b4-a49d-03ac92f40b76
title: Telemetry settings
ord: 50
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-telemetry",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/telemetry
---
A machine settings section where the operator configures the server's record of its own work: metrics, traces, the CPU sampler and storage limits.
