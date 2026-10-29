---
id: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
title: Held resources
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/holding.ts"
      },
      {
        "at": "src/failures.ts"
      },
      {
        "at": "src/Held.ts"
      },
      {
        "at": "src/Flight.ts"
      },
      {
        "at": "src/Capacity.ts"
      },
      {
        "at": "src/Passes.ts"
      },
      {
        "at": "src/Waiters.ts"
      },
      {
        "at": "src/Section.ts"
      },
      {
        "at": "src/Lane.ts"
      },
      {
        "at": "src/Permits.ts"
      },
      {
        "at": "src/PreparedWorker.ts"
      }
    ],
    "id": "@runlith/held",
    "kind": "kit"
  }
edges:
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/held
---
The server declares its locks, queues and writers as resources in one order, and the package gives the mechanisms that order is built from: holding, flight — one unit of work per key — capacity tickets, first-come permits, passes, waiters by key, lanes and sections. Which resources exist and in what order to take them is the product's call.
