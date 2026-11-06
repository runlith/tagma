---
id: 01a174f2-3d66-76d1-9288-c921d7074a11
title: Extension views
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-views",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/views
---
An app and an MCP server draw their interface in an isolated frame, and the module owns that frame: message bridge to the view, host styles, parameters, and tool notifications.
