---
id: 01a188f5-84f7-767d-96d1-6554722cb1b9
title: Block translations
ord: 52
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "translations.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "translations",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "translator/",
        "store/",
        "contract/service/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
sources:
  - kind: dir
    ref: apps/tagma/server/src/translations
---
A reader sees a block in their language without rewriting its source. The module owns translation projections, changed-part detection and batching; the graph supplies the text, and providers chooses and asks a text-capable model through ModelAsks.