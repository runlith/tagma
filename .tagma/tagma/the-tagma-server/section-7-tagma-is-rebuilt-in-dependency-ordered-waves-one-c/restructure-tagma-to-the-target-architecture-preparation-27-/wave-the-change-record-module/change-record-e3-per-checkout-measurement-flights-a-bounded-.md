---
id: 01a0ea07-b534-75c4-8cc0-d5adfa653215
title: "change-record E3: per-checkout measurement flights, a bounded shell-observation queue, and pending-op state so a write stops rereading pending tool changes"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e445-113b-70ed-907c-9d7b9c085c6c
---
§3.13 of [[9c085c6c]], which the change-record card in [[f7e0b9dd]] §7.5.10 assigns to this module. It is producer and lifecycle work, not part of M2's move table. Found by wave-power during M2 [[418f681b]].

- **W10, measurement flights.** Baseline measurement becomes one flight per checkout, joined by concurrent commands. `ShellRun.ts` still calls `baselines.measure` for every command, at 276 and 353.
- **W10, observation queue.** Shell observations go through a bounded advisory queue with a reader barrier: a reader sees every observation enqueued before its read, and the queue never grows past its bound.
- **W12, pending-op state.** Pending tool changes carry an `unknown / empty / holding` state, so `record/write.ts#land` stops calling `readPendingToolChanges` on each write (it does at 192) and reads only while `holding`.

Done when:
- the three stand;
- unit tests cover the flight join, the queue bound and barrier, and the pending state transitions;
- a Muse performance lens has read it;
- the cost of a command or a write follows its own change, never the pending history (rules 2393aff1, fe83acfa).