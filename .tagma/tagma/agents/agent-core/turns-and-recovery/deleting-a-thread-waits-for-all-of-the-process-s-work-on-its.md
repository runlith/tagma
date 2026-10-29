---
id: 01a16d48-2aa8-780b-954f-5a9b4a67b8ac
title: Deleting a thread waits for all of the process's work on its runs, not just the running lines
ord: 18
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/run/RunExecution.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadDeletion.ts
---
A run's end is written before its work ends. A native run writes the end line in its own tracked fiber, and in that same fiber the settlement subscribers and the final snapshot publication follow. Turn preparation also stays the process's work until its own fiber ends, even when the start entry is already removed: `RunExecution.driven` includes it, and `drained` waits together with the driving fiber. `settled` keeps the narrower meaning of the driving episode's end for resumption; waiting for its own preparation there would close a hosted start on itself. An end written in a transaction (closing a terminal transport, eviction on opening) wakes publication in the outbox background. `ThreadDeletion` holds the whole removed subtree's `RunAdmission` from selecting running turns until deleting the lines: a settlement's child and queued words do not open the next turn in that window. A successful deletion lifts the hold without a wake; refusal, interrupt, and rescheduling return the surviving threads their chance to continue. So after stopping the running turns, `ThreadDeletion.settle` waits for `RunExecution.driven` and `ThreadSettlementOutbox.publishing` for the thread trees within the same `within` (not waited out — `still-settling`), then `ThreadSnapshots.forget` lifts status deadlines and started revisions. After stopping the producers, deletion waits for `ActivityLog.settled` outside the unit: the writer must attribute facts to projects while the thread lines still stand. That barrier is interruptible; a passed `within` returns `still-settling` when the write has not confirmed in time, and the lines stay. `clear` counts the process's remaining work as a blocker inside the deletion unit. Without this, the lines vanished under a working subscriber: `SettlementClaimLost` and `Thread not found` from `ThreadSnapshots.reading`.

Boundary: deletion requested synchronously from inside that same work (a settlement subscriber or a plugin `on.ended` hook deleting its own thread) waits for itself until `within` and refuses `still-settling`; without `within` (`deleteByHost`) it would wait forever. No such caller exists now.
