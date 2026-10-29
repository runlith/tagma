---
id: 01a17ddd-362d-77be-8029-0a36bf069562
title: A bare file name in an agent message resolves in the thread's scratch if nothing stands at that path from the thread root
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17da6-a2c2-7c54-9918-ca939ba03118",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/place.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/operations/pairs.ts
---
Tagma operations read a bare file name from the calling thread's scratch, while the thread feed confirms a link only from the thread checkout's root: a `report.md` name the agent left in scratch stays text. `place_path` takes a thread, and unless anything stands at the relative path from the first base, reads it from that thread's scratch; the thread feed passes its own thread. Where that scratch lies, `checkout-files` learns through a port, which composition fills from `ScratchAreas`.
