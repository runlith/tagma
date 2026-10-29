---
id: 01a17aff-0013-783e-93b0-82167556936c
title: The host terminal stream owns pty byte carry and terminal input admission
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionInput.ts
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: file
    ref: packages/execution-host/src/ptyLaunch.ts
---
A Bun Worker in the host logic process with the OS interactive QoS class takes `Descriptor` and `ExecutionInput` of every pty execution away from the main loop. The main loop receives the read bytes as a copy through a bounded buffer — the source of the record and the screen mirror — and talks to input with messages; a logic change carries synthetic echo and the input remainder through the stream. Pipes stay on the main loop. Done when the existing input, interrupt-echo and carry-over tests pass with input in the stream; an endpoint itest proves that a stalled main loop doesn't delay a keypress.
