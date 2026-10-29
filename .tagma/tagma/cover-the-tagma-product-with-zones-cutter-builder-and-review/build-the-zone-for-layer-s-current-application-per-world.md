---
id: 01a0c702-1918-7284-a171-07e15341488d
title: Build the zone for layer's current application per world
ord: 66
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c714-d93b-7012-8833-55cc234e11e4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/layer/src/request
---
Fill [[ebdf5231]] with the claims its code establishes. Read `src/request/holder.ts`, `src/request/node.ts` and `src/request/browser.ts` whole, with `src/server.test.ts`. Watch: what the tab does when a new definition arrives and why; why the server refuses to hold an app outside a request instead of opening one; what closes a request's app and when; and what the install-on-import seam keeps out of the core. The module states the Node reach this area is the whole of — [[aca0e876]]. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].