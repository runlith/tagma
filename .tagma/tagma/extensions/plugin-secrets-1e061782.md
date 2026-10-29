---
id: 01a174f2-3d65-7e23-bb0f-9d871e061782
title: Plugin secrets
ord: 33
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-plugin-secrets",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/secrets
---
A plugin needs keys and tokens, which the operator enters in a settings section; the module shows the declared secrets and writes them to the server.
