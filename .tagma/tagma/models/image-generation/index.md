---
id: 01a15bd0-13f8-713e-8975-1482ecdb8134
title: Image generation
ord: 39
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "images.ts"
      }
    ],
    "id": "images",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-beed-7934-884b-a443f92da92b
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: apps/tagma/server/src/images
---
An agent on any model draws and edits pictures through the image model of the provider the operator is signed into. The module owns the generate_image operation, the choice of image model by setting and accounts, and the drawn picture staying an original in the thread's attachments folder; the model call and quota are managed by providers, the feed by the client.
