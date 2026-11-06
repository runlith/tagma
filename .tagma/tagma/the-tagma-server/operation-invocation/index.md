---
id: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
title: Operation invocation
ord: 177
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "invocation.ts"
      },
      {
        "at": "assembly.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "registry.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      },
      {
        "at": "presentation.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "invocation",
    "kind": "substrate",
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
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
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
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a0fd8b-bf07-7e08-a660-42bdab05dfec
  - kind: imports
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a10c61-1e17-72d3-b0d5-117293a21200
  - kind: imports
    to: 01a1231f-29af-74c6-9e71-e4a62243eda2
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/server/src/invocation
---
Every Tagma operation is invoked one way, whichever door it came through, and this module is that place: the operation registry, call admission, assembly of the call's services — who calls, the project and place, the graph, the checkout — and execution with typed refusals. A door only decodes its own transport and draws the answer; operations are declared by their owner modules.
