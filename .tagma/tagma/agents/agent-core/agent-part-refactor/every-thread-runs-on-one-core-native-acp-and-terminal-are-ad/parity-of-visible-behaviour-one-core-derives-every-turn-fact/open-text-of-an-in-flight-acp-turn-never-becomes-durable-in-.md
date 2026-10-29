---
id: 01a14e22-df0f-7912-ab76-2362d2cbdb5d
title: Open text of an in-flight ACP turn never becomes durable in thread_run.stream_tail, so a server crash leaves no partial answer and no interruption row
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e05-7134-77c7-93bb-3af5a556dc51
---
Observed (`parity.stest`, scripted Claude agent on `acp`, word `STREAM`): the turn's open text "Partial" is visible in the live tail, but the run's `thread_run.stream_tail` stays empty for 20+ s, with a stop and without one. On native the same turn writes the tail, and after a server crash the close gives "Interrupted to deliver 1 steer" with a partial answer; on ACP with no tail there is neither a partial answer nor an interruption line (by the native rule the row writes one only with an open tail).

The driver timer (`ProtocolRuns.tailed` via `journal.tailEveryMs`) should flush the tail on `tailDue`. Assumption, unverified: the flush step passes `recorded` with the same evidence (`incarnation:cursor:counter`) as the already saved step and answers `replayed` before `snapshotted`; or `tailDue` does not see the tail change. Start from a measurement: a `STREAM` turn without a stop, waiting for a non-empty `stream_tail`. Proof — the same parity scenario "words while a stop is still ending, server crash" with the expected "Interrupted to deliver 1 steer" row on ACP.

## Outcome

Commits 2f29b8ce64, e6b28cb92e. Cause: the tail-flush timer (`ProtocolRuns.tailed`) called `persist` with sealing, so open text became a finished message while `stream_tail` stayed empty; on a stop the tail was never written at all. Fix: the timer saves the step without sealing, the `Cancel` step writes the tail at once (`StepPlan.tail` → `HarnessTurnStep.tail`), and a tail-only report is keyed `|tail` so it cannot collide with a read report of the same step (review finding). Tests: parity "words sent while a stop is still ending…" waits for a durable tail and waits for the row and partial answer on both roads (red without the unsealed flush), the crash variant waits for the row and partial answer on ACP (red without the tail on Cancel), protocolStops "a stop right after the agent reported its context…" (red without the `|tail` key). Debt of 650 lines on steps.ts — [[0cdc65a3]].

Not proven: continuing the same open message after a flush and an adoption by a new server is not covered by a separate test.
