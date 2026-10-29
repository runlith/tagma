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
A reader reads a block in his own language without anyone rewriting it: the module translates a block's title and body by parts into a projection kept in its own machine table beside the graph, marks the parts changed since, and sends only those to the model again. It owns the subject-agnostic translator core (parts, placeholders, batches, the answer frame check), the projection store, the `translate_block`, `read_block_translation` and `stop_block_translation` operations with their live frames, and the `translation.*` settings; the block's text comes from the graph, model choice from the threads' cheap-question chain, and the model call and accounts from providers.