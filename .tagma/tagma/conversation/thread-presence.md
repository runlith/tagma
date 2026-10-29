---
id: 01a174f2-3d5a-7431-8610-6fcfbbff045a
title: Thread presence
ord: 40
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-presence",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/presence
---
The graph and the checkout show which thread holds a block or lines, and the module gives them that knowledge: a presence subscription, holdings, and a thread link that is followed without knowing the threads module.
