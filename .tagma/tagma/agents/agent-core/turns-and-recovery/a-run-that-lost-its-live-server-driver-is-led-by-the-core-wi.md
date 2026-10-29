---
id: 01a15b9a-5f47-7cf9-8054-eb6453856e16
title: A run that lost its live-server driver is led by the core with the same adopt as a dead-server run, and spends a recovery attempt
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/run/ownership.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunReaper.ts
  - kind: symbol
    ref: packages/agent/src/thread/state.ts
    symbol: runHalt
---
The reaper takes only others' runs: those handed over on departure (`handed-over`) and those silent past `takeoverAfterMs` (`foreign-owner`). It finishes its own silent run with a failure through `staleRunningAfterMs`. So a transport whose driver died on a running server hands the run to the core itself via `RunOwnership.dropped(threadId, failure)`. Waiting for the run to go silent is unnecessary: the server already knows nobody holds the run on it.

The core takes the thread's active run if it is its own, stands on no question, and is held by no transport. The run receives a `dropped` note with the cause, then the reaper's ordinary decision follows: a standing stop, transport `adopt`, or cut. The `dropped` selector takes its own run with no silence condition and, unlike `handed-over`, spends a recovery attempt. Without that, a deterministic driver failure would spin the run forever. Exhausting the limit and a transport refusal end the run with cut, and the driver failure enters the cause. A stop recorded after the snapshot ends `adopt` with `aborted`, not cut: a claim with a stop takes neither its own run nor another's. If the run is driven again by another drive of this server, the transport answers `ownership-lost`, and no attempt is spent. Adoption writes a `retry` entry to the feed with the `driver-failed` family: attempt number, limit, driver failure.

Adoption puts the same cause in one phrase into the run's `progress.halt`. `RunStatus.halt` and the thread-list line show it only while the run has `resumes > 0` (`runHalt`) — that is, until the restored run makes durable progress. So entries resetting `resumes` need not erase `halt`: a stale cause simply is not shown. The stage entry (`writeProgress`, the next `adopt`) replaces `halt`; the phase entry keeps it. At transport reports (`RunReports`), durable progress is a new agent entry (reasoning, tool, its response) or a finished step, as with native. Words given to the agent and `retry` do not extend the budget: otherwise a run whose driver fails on the same output would restore forever.

The reaper's batch collection still never takes its own runs. Its own run's silence may mean the transport has not yet placed its hold. Who lost the run must decide — not a heartbeat guess.
