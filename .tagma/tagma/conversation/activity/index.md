---
id: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
title: Activity
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/Activity.ts"
      },
      {
        "at": "src/cause.ts"
      },
      {
        "at": "src/fact.ts"
      },
      {
        "at": "src/log.ts"
      },
      {
        "at": "src/modelCall.ts"
      },
      {
        "at": "src/testing.ts",
        "role": "testing"
      },
      {
        "at": "src/store/ActivityStore.ts",
        "for": [
          "aa6db0fc",
          "13182a9f"
        ]
      },
      {
        "at": "src/store/record.ts",
        "for": [
          "1a45453a",
          "ab05dfec",
          "13182a9f",
          "f92da92b"
        ]
      },
      {
        "at": "src/store/query.ts",
        "for": [
          "ab05dfec",
          "13182a9f"
        ]
      },
      {
        "at": "src/fault.ts"
      },
      {
        "at": "src/store/faults.ts",
        "for": [
          "aa6db0fc",
          "13182a9f",
          "1a45453a"
        ]
      }
    ],
    "id": "@runlith/activity",
    "kind": "kit",
    "order": [
      [
        "src/fact.ts"
      ],
      [
        "src/cause.ts",
        "src/log.ts",
        "src/modelCall.ts",
        "src/fault.ts"
      ],
      [
        "src/Activity.ts"
      ],
      [
        "src/testing.ts"
      ],
      [
        "src/store/schema.ts",
        "src/store/query.ts",
        "src/store/delta.ts",
        "src/store/document.ts"
      ],
      [
        "src/store/record.ts"
      ],
      [
        "src/store/writer.ts",
        "src/store/faults.ts"
      ],
      [
        "src/store/bodies.ts"
      ],
      [
        "src/store/body.worker.ts",
        "src/store/upkeep.ts",
        "src/store/reading.ts"
      ],
      [
        "src/store/faulting.ts"
      ],
      [
        "src/store/ActivityStore.ts"
      ],
      [
        "src/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
sources:
  - kind: dir
    ref: packages/activity
---
So that the question "who, why, with which model, on which input, and with which effect" over the last day is answered by one record, every producer — the agent loop, tool door, model transport, compaction, settlement, collaboration, naming, and recap — opens an activity through one combinator, and the server mounts its store. The package owns the activity envelope and its identity, the `ActivityLog` and `ActivityCause` ports, the interrupt-surviving combinator, the built-in `model-call` kind, the `activity.sqlite` store with bodies in hourly files, and `ActivityRecord` reading: it selects and pins the id set or group answer in the store process and serves pages under the envelope ceiling. Write-state diagnostics are available independently of the database. What a specific kind and its facts mean is the producer's call; retention and body budgets are server settings, and the question language and row address are the `read_thread` door.
