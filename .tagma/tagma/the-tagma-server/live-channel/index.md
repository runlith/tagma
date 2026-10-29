---
id: 01a0fd8b-bf0c-778a-8cab-a767627a3d25
title: Live channel
ord: 179
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "live.ts"
      },
      {
        "at": "rpc.ts"
      }
    ],
    "id": "socket",
    "kind": "surface"
  }
edges:
  - kind: imports
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
sources:
  - kind: dir
    ref: apps/tagma/server/src/socket
---
Whatever changes while being watched — threads, terminals, load — the app receives through a WebSocket subscription, not polling. The module owns this channel and its call journal; each feed's owner modules declare what it publishes.
