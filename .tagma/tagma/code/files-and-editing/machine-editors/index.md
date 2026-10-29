---
id: 01a1555c-b587-793c-ac98-7a6fabf5a0b8
title: Machine editors
ord: 13
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "contract/wire/"
      },
      {
        "at": "contract/service/"
      }
    ],
    "id": "editors",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
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
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
sources:
  - kind: dir
    ref: apps/tagma/server/src/editors
---
The operator opens a file from Tagma in their editor at the needed line, with the checkout as the project. The module holds the editors catalog as data, remembers in memory which of them are installed on the server's machine, answers with this list with no search wait while the answer is fresh, and launches the chosen editor, remembering the choice as the operator's setting. How to find an editor and open a link on this OS it does not know: that is the `EditorHost` port, filled by OS adapters, with composition choosing the adapter by platform.
