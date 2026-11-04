---
id: 01a1a698-f793-7779-8b4b-3e9a010f34d2
title: App documents
ord: 10
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "app-state.ts",
        "for": [
          "13182a9f"
        ]
      }
    ],
    "id": "app-state",
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
sources:
  - kind: dir
    ref: apps/tagma/server/src/app-state
---
The operator's arrangement of the app — the dock, the place each project resumes at, the rail's pins — has to look the same in every window and on every device he opens Tagma from, so it cannot live in one browser's storage. The module keeps the documents the app writes for its operator on the server, each with the revision it was last written at, and tells every window of each change with the writing window's name. It never reads into a document: what each one holds, and how a window merges a change into what it shows, belongs to the app.