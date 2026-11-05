---
id: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
title: Project worktrees
ord: 13
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "store/tables.ts",
        "for": [
          "ab05dfec"
        ]
      },
      {
        "at": "worktrees.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "layer.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "assembly.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "listing/channel.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "retirement/finishing.ts",
        "for": [
          "9543a701",
          "1a45453a"
        ]
      },
      {
        "at": "progress.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "listing/mergeChecks.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "retirement/gates.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "retirement/guards.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "worktrees",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ],
      [
        "steps/"
      ],
      [
        "worktrees.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beef-70cb-81c5-89e59e75d459
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a0fd8b-bf13-7e86-86fd-2245f20c91d2
  - kind: imports
    to: 01a1138f-eb48-7270-a39f-b386a1c2b760
  - kind: imports
    to: 01a14c88-d8a5-72b1-b18e-4eef96171a9b
  - kind: imports-tests
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees
---
Parallel work runs in separate worktrees, and the module owns their life: creation with preparation — copied files and a setup command — branch and its name, listing and occupied space, deletion and cleanup. Merging the branch back and pull requests are left to landing.
