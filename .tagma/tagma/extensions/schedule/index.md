---
id: 01a1233a-897c-783a-afb3-103fd50acfdc
title: Schedule
ord: 32
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "schedule.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "receiving.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "schedule",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "store/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
sources:
  - kind: dir
    ref: apps/tagma/server/src/schedule
---
Something in Tagma must happen on its own, by time: the bridge to an external service polls it once a minute, the duty agent wakes once an hour. The module holds such periodic launches: at most one at a time per schedule, and ticks missed while a launch ran, the machine slept, or the server was stopped do not accumulate — one launch goes instead. It remembers when the next launch goes and how the last one ended, and it does not keep the machine awake. Whom to deliver a tick to and what to do with it is the recipient's decision, wired by composition; owners declare schedules.
