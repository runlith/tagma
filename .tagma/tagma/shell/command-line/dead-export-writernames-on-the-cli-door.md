---
id: 01a0caeb-9631-75e8-b5ba-125489798a3d
title: Dead export `writerNames` on the CLI door
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/cli/door.ts
    symbol: writerNames
---
`writerNames` is exported from the CLI door and called by nothing in the checkout. Either a road was meant to resolve writer names through it, or it is residue.

Done when it has a caller or is removed.