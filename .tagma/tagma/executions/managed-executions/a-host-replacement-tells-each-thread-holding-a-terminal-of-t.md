---
id: 01a0de2b-897a-7dc0-b78d-7099c60e52fb
title: A host replacement tells each thread holding a terminal of the replaced generation that the terminal is gone
ord: 89
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de17-2c68-7a3d-95dd-c204a488f8a5",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/terminals/terminalsLayer.ts
    symbol: terminalsLayer
---
A restart that replaced the execution host (wire 30 → 34, then an immediate restart through the host's recovery program, 2026-09-26 02:16 UTC) ended four thread-held terminals and nobody told the holder ([[941fe5bd]]). Surviving a replacement is the open idea [[fb5c1b45]]; this task covers the silence: the terminals floor reads the thread-held rows before a replacement and, once a successor stands, owes each holder a custody-road notice. Proof: `TerminalStore.itest.ts` and `takeOverNotice.test.ts`; the end-to-end road through a real replacement is a system-test case not run here.