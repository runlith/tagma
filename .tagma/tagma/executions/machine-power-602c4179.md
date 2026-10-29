---
id: 01a174f2-3d5c-7f13-b9d4-5983602c4179
title: Machine power
ord: 48
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-power",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0fd8b-befd-77ef-ac51-f681d12dd963
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/power
---
The operator decides whether to keep the machine awake while agents work, and how they work when resources run short; the module holds these two server states and their keys. The shell draws the buttons in the status line.
