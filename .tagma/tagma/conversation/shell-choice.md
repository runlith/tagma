---
id: 01a174f2-3d61-78d0-a85f-42a67ddf60a8
title: Shell choice
ord: 43
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-shell-choice",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/shell
---
One browser opens the desktop or the mobile shell, and the operator chooses it here — automatically by touch or explicitly; the choice is stored in the browser and reloads the app. The name the app gives the operator's computer lives here too.
