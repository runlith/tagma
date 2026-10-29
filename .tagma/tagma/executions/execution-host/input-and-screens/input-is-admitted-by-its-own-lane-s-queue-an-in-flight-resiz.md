---
id: 01a17b78-590e-7a69-8afe-7717447ddfbb
title: "Input is admitted by its own lane's queue: an in-flight resize holds only its lane and other resizes"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionInput.ts
  - kind: file
    ref: packages/execution-host/src/inputAdmission.ts
---
Sequence counts the lane, so one lane's acts admit one at a time in arrival order: the next awaits the previous receipt. Otherwise it would read the not-yet-moved `next` as a conflict, and a retry of the same sequence would run resize twice.

Different lanes' acts never await each other. A resize in the terminals stream answers only after the main loop rebuilt the record grid and the interpreter. One lock for all lanes therefore made a window press wait on a frozen main loop ([[45e50d9b]]).

Only two act kinds serialize across lanes:
- resize — the ioctl order must match the record-grid order, otherwise pty and grid diverge;
- interrupt — they share the queue-drop counter.

Closing intake before the logic change at once refuses new acts with `yielding`, even if their lane is busy, and awaits only acts already in flight.

An act that finished after the custody-epoch change answers with its receipt but is never written into the new epoch's lane book. That boundary used to be held by the shared lock. Now the queue itself holds it: otherwise a completed resize would read the new epoch's empty lane as a conflict.
