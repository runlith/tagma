---
id: 01a193d9-9a1f-79e8-9f71-7aa247a2ed10
title: Graph asks the remote-side port at birth, opening, storage moves, topology and after commits, and keeps no remote address in core state
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a193d9-9a1f-79e8-9f71-7a96e41dca93
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a984d16c47c
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7aa127a53600
---
All of [[e41dca93]], including the migration that drops `graph_remote` and the contract-test filler.