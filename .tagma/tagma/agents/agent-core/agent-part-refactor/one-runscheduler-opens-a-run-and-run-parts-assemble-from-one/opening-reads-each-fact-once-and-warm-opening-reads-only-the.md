---
id: 01a11aeb-d1e9-785b-9a9b-857455529470
title: Opening reads each fact once and warm opening reads only the history suffix
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9124eb2a5ae8
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd0a34152ed
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/runLog/openingCost.ts
---
Remaining opening-cost criterion from [[a34152ed]], not closed in [[eb2a5ae8]].

Done (d0fe7a3, 29a9f09). Measured by `conformance/runLog/openingCost.ts` on both adapters: before the first model request, each fact is read once — `store.metadata`, `runs.latestRun`, and the included history.
- `ThreadAdmission` passes the owned row down to `ThreadAggregate.send/queue/steer`.
- The budget takes the root row the caller already holds (`budgetQueryOf`).
- `Queues.standing` returns the run it saw (`StandingRun`), and `speak` does not re-read it.
- The test checks the read count of each fact and the row count per fact at two history lengths, without the byte fudge and the history-growth assertion.

The one deliberate repeat: `transitions.readRecord` is read twice. The read outside the transaction is the only read of the record for an act refused before any transition, such as a budget refusal. The read inside the transaction is the authority under the lock. Admission conformance shows a recorded budget refusal replays under the same key even after the budget changes.

Left:
- **Warm reopen** reads the thread row with full history (`transitions.readAt`, O(H)). Build the fold suffix path (state between runs), then assert in `openingCost` that a warm open reads only the suffix.
- Replace the test's publish classifier, still held together by regex over the stack trace (`PUBLISHED`), with a signal the product itself provides, once the suffix path gives a reason to rebuild the measurement.
