---
id: 01a127b1-a1ba-72eb-b28f-14e95979e2e6
title: A run stop from a process that does not hold it waits for the live owner's last tail
ord: 41
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1274e-49c5-7984-93dc-85577fe87be3
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunLifecycle.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/RunExecution.ts
    symbol: RunExecution.halt
---
As today: `RunExecution.halt` in process B, which does not hold the run, calls `lifecycle.stop(run, intent, false)`. `stopNow` writes the run end at once. The live owner process A does not learn of it and keeps streaming. Its next flush gets `SequenceUnavailable ended` ([[7fe87be3|the end after the last flush]] removed seq acceptance after the end). What A showed but did not yet record is lost. A supported scenario: `conformance/runLog/processes.ts`, the test "a reader's stop ends a run the answering process does not hold…".

What is needed: when the owner is live (heartbeat fresh), a foreign stop only records `stopRequest`, and the owner notices it and closes the run with its own loop — flush, then settle. The end is written at once only for a dead owner. That needs a channel for the owner to learn of another's `stopRequest`, e.g. its heartbeat answer. Also a stop-latency bound justified by the machine range, not by a value in the test. Accepting seq after the end must not return.

Prove through the public operation: B stops A's run holding a shown but unrecorded tail. The tail lies once in the journal and stands before `run-end`.
