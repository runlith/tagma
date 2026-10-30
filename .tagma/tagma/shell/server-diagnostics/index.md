---
id: 01a0fd8b-bf02-7b35-8c99-f0b29bb175ec
title: Server diagnostics
ord: 42
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/wire/"
      },
      {
        "at": "voice.ts",
        "for": [
          "96400e93",
          "ab05dfec"
        ]
      },
      {
        "at": "performance.ts",
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
        "at": "reads.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "contract/service/measurement.ts",
        "for": [
          "64d4c5ab",
          "13182a9f"
        ]
      }
    ],
    "id": "performance",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
sources:
  - kind: dir
    ref: apps/tagma/server/src/performance
---
To take slow calls, hangs, and memory growth apart, the server records its own work — spans, event-loop delays, CPU profiles, and memory snapshots — and answers questions over what it saved. The module owns these on-request reads and captures, including live causal costs from the process-lifetime retained suffix; the recording mechanism is the @runlith/performance package.
