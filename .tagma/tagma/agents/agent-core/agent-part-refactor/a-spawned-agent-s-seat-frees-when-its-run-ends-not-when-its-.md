---
id: 01a127ae-99ff-7963-9b18-4a0e6968f4e1
title: A spawned agent's seat frees when its run ends, not when its end notification is delivered
ord: 40
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
    ref: packages/agent/src/collaboration/births.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationResidency.ts
---
`SpawnSeats` frees a child agent's seat only in `births.settled`, i.e. when the notification of its run end is delivered. That is asynchronous to the end commit. So between "the run ended, the thread is idle" and delivery, a fresh `continue` of another child refuses: "This host runs 1 spawned agents at once and all 1 are working".

How to reproduce: `runLog.processes.itest.ts`, the test "a restarted process seats the spawned run it adopts…". It fails on the `continue()` after waiting for `status === 'idle'`:
- clean HEAD 075a6c8006: 5 failures in 6 runs.
- fb6a1c777c, before the 5b569767 cancel cut: 3 failures in 4. So the defect predates that cut.

What to do: free the seat where the run end commits, not in notification delivery. The test must pass 10 times in a row.
