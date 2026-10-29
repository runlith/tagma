---
id: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
title: Opening links and paths
ord: 18
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-opening",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports-tests
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports-tests
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
  - kind: imports-tests
    to: 01a174f2-3d5a-7431-8610-6fcfbbff045a
  - kind: imports-tests
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports-tests
    to: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
  - kind: imports-tests
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports-tests
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/opening
---
A link or path from chat, terminal or graph opens through one mechanism: a registry of link kinds declared by features, a "where to open" rule, path parsing and checking with the link row and menu. The view the link leads to is drawn by the owning feature.
