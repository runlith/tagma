---
id: 01a1366b-3162-7e65-b387-3bdbc79273c3
title: "\"The successor's release wait removes its own timers and listeners itself: the Effect.callback finalizer runs only on interruption\""
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/succession.ts
    symbol: released
---
The effect returned by the `Effect.callback` registrar runs in effect@4.0.1 only on interruption (`asyncFinalizer`), not on a plain `resume`. While cleanup lived only there, the successor after handing over the data directory polled its predecessor's `kill(pid, 0)` every 100 ms for its whole life and held IPC listeners; in a running server's profiles that shows as `pidAlive`. So every `resume` path in `released` first removes the interval and the listeners.
