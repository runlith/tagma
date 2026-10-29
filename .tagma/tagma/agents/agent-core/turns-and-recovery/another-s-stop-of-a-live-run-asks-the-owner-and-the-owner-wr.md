---
id: 01a127cf-6805-746b-a756-7ae0fcbe2a1d
title: Another's stop of a live run asks the owner, and the owner writes the end after the last tail
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunLifecycle.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunBeater.ts
---
Only the run's owner writes to the journal, because after the end the transition over seq receives `ended`. So a process that does not hold the run does not write the end to a live owner itself. It records `stopRequest` and answers `requested` at once. The owner receives the request in its own heartbeat write's answer (`writeHeartbeats`), stops the run with its own loop — flush, then settle — and the run ends `aborted` from whoever asked.

Only a caller needing a finished run awaits the end (delete, rewind — `awaitSettled`, `RunLifecycle.drain`): while the owner's heartbeat is fresh, but no longer than `staleRunningAfterMs` — the bound for a hung drain.

The owner reads as dead when its heartbeat is older than `takeoverAfterMs` or the run is handed over on departure (`handedOverAt`). Then the stopping side writes the end itself (`stopNow`).

A parked run with nothing to drain is ended at once by the stopping side, but after the request record: an answer taking the run at that moment sees the request and refuses.

Cost: another's run ends after the owner's heartbeat interval, and the end-awaiter pays one more run-line poll turn. This is the price of no inter-process signal: the run line is the only shared channel.
