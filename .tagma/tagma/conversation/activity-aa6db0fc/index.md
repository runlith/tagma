---
id: 01a11241-8e1a-7151-a20e-e97daa6db0fc
title: Activity
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "activity.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "contract/service/place.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "contract/wire/"
      }
    ],
    "id": "activity",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "layer.ts",
        "faults.ts"
      ],
      [
        "operations.ts"
      ],
      [
        "activity.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
sources:
  - kind: dir
    ref: apps/tagma/server/src/activity
---
The server mounts the activity.sqlite storage, sets its retention and body budgets from settings, and on every start removes the previous trace-bundle catalog. The module owns this mounting and the `activity.*` settings and hands the server's defects out of activity: to the window — a live `faults.subscribe` feed for the Errors button, to the agent — the `read_faults` operation, and to the operator — `clear_faults`, a mark after which previous defects leave every window. Writing, storage, and reading are the @runlith/activity package, taken straight from it by threads and the `native-harness`.
