---
id: 01a12877-c4e4-71a5-aac7-b90cb36ea795
title: "The holder shared core and frame protocol make no OS calls: a platform trait with a macOS module"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
sources:
  - kind: dir
    ref: packages/execution-host/native/holder
  - kind: dir
    ref: packages/execution-host/src/holder-client
---
Carve out the shared core in `native/holder` (loop, table, frame protocol, logic restart policy, readiness, handover) and the platform trait per spec [[7df613b0]]; the macOS module fills it whole. In the frame protocol: SIGNAL carries the signal name, capabilities are declared by the holder in HELLO. The frame protocol's TS client leaves `src/posix/` for the shared holder client; the POSIX adapter keeps handle passing and their I/O. Done when holder.itest, nativeLaunch.itest, and the contract set are green through the trait, and the holder core contains no libc call.
