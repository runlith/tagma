---
id: 01a0cad6-b05a-7cc0-8a94-01a8af0b168a
title: A condemned opening returns an acquisition over a scope already closed
ord: 55
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/cache.ts
---
An opening condemned by a release that landed mid-opening closes its scope and returns the acquisition WITHOUT recording it (`held.set` skipped). The asker receives an acquisition over an already-closed scope: harmless for checkout worlds, a dead channel for guests until the next ask reopens, and no caller checks liveness before using it.

Done when the condemned branch either records-then-releases or refuses the asker instead of handing a dead world.