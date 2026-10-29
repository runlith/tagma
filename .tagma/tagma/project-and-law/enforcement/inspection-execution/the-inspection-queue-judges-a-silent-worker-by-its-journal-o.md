---
id: 01a122fe-a13b-71c0-818b-1870806049cb
title: "The inspection queue judges a silent worker by its journal: only a proved loss fails, and time only decides when to ask"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/waits.ts
---
There is no request term: a check of a project of any size runs as long as it runs, and a worker busy with synchronous work simply doesn't answer a state question — and is waited for. Only a loss the messages themselves prove fails.

- **Messages go in order.** A state question is sent after the request, and its answer after the request's answer. So a state where `received` doesn't equal the request id proves the request never reached the worker (it is sent again), and a state with an `answer` arriving before its own answer proves the answer was lost (it is taken from the state).
- **A lost process exit** is the same pid in two answers in a row with no journal movement: the system calls it a zombie or gone (`ps`), and the worker never saw the exit. Such a request fails with the journal in the reason and is repeated once in a fresh worker.
- **"Exit seen" reads synchronously** from the handle's `isRunning`: on POSIX the native Bun spawner reads the already recorded runtime exit code or signal; on Windows the old Node adapter keeps the tree kill via `taskkill`. A fiber waiting on `exitCode` would mark the exit a step later: after a busy loop two answers in a row would arrive before the mark and give a false "stuck". For the same reason the worker reads state only after one loop turn: waiting kernel events get to sort out.
- **With no movement the journal goes to the log** once per counter value — evidence for the next hang's cause.
