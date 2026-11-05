---
id: 01a0fd8b-bef1-758e-b119-40b1d962023e
title: Project knowledge graph
ord: 47
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "store/tables.ts"
      },
      {
        "at": "."
      },
      {
        "at": "contract/service/transaction.ts"
      },
      {
        "at": "journal/"
      },
      {
        "at": "orientation/"
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "work/Batch.ts"
      },
      {
        "at": "work/lifecycle.ts"
      },
      {
        "at": "work/retirement.ts"
      },
      {
        "at": "voice/blockPage.ts"
      },
      {
        "at": "voice/lines.ts"
      }
    ],
    "id": "graph",
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
        "graph.ts"
      ],
      [
        "testing/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6ef-834d-72bb-a092-d74196b75e80
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
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
  - kind: imports
    to: 01a14c88-d8a5-72b1-b18e-4eef96171a9b
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph
---
Tagma keeps a project's knowledge as one graph, and this module is the graph itself: blocks and their recording, the tag vocabulary, edges and sources, the work-and-rules law, the change journal, search and session orientation, plus the graph as the `.tagma` files the repository carries and their sync. It leaves rule judgment over code to enforcement and the on-screen graph view to the app.
