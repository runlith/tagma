---
id: 01a126a2-f7fc-7474-b60a-c2218783a621
title: "Core of call life: admission and queue in the record, dedup of hosted after restart, door outcomes at Stop, hosted waits like native"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126a3-dbf1-7698-b952-b186fd88090b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12685-91d6-74c9-bb18-016b7edf92bf
---
The call lifecycle core in `packages/agent`: items 2 (door, native and hosted parts), 3, 4 (the `ThreadHosting.display` member), 5, 7 (`giveWay`, `callStops`), and step 1 of item 13 of the [[7edf92bf]] spec.

What to do:
- `AgentCall`: `running` and `detachable` at `admit`; before that `waiting` with a reason; `limitCeilingMs` in the `CallRecord`; a truthful `limit` refusal text; admission returns the record's `execution`.
- Native: `ThreadToolRecords.execution(...)` — `queued` with the path reason and `started` at admission; on abort the loop waits for the door's outcomes within the stop grace and writes them via `settle`.
- `ThreadHosting`:
  - a bare `started` record with the preparation display after `reached` and `queue`, before the work; a record-write failure means refusal with no execution;
  - pinpoint dedup by record (`queued` means execute; `started` or no field means `output-unknown` with no execution);
  - wait for run ownership until `adopt`, then the `run-not-held` code (the ACP task repeats it);
  - `display(threadId, name, input)` synchronously, only from the already-built assembly, with no semaphore;
  - the outcome's `committed` checks that the run is still going;
  - `ready` from the sealed assistant-message call order plus `door.pendingWrites`;
  - `AgentRunner.host` listens for words (unread means not delivered, or delivered by steer with no `fate(read)`); confirmation waits race `door.callStops`.
- `RunClosing`: `output-cancelled` only for a `queued` Tagma call on `acp`; everything else is `unknown`.

The `ThreadToolEntry.execution` field already stands in `transcript/entries.ts`. Contract for neighboring tasks: `ThreadHosting.display` and the `run-not-held` code — the ACP task waits for them; `CallRecord.limitCeilingMs` — the feed task waits for it.

Cost of the `started` record (measured, one sample on the operator machine, bun:sqlite, 20 sequential hosted calls of one message, conformance harness): 702 and 915 ms with the write versus 362 and 549 ms without — about 17–18 ms per call, roughly double the hosting writes per call (the second transition-checking write in decide).

Done when criteria 2, 5, 6, 7, 11 of the spec are proven by tests, typecheck and the affected suites are green, review under the model rule passes.
