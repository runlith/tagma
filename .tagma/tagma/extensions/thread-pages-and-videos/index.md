---
id: 01a174f2-3d87-7c0f-a1ab-7d1319afd604
title: Thread pages and videos
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-pages",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-bf00-7c53-8428-280109c9ec78
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d45-708d-99bc-b9d9a8449383
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/pages
---
The agent renders pages and videos for the operator, and the module shows them: page panel and card, zoom, motion player, video export and thread pages. Which team it belongs to is answered by the `PageTeams` port, filled by composition.
