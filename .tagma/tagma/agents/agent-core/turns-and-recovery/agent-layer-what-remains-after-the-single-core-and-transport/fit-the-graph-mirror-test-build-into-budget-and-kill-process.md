---
id: 01a1520d-63b9-715d-92db-df3621d412fb
title: Fit the graph-mirror test build into budget and kill processes on cancel
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-f130-7288-b1a4-5256485048d5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09d4cc3ca850
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/cli/hookPlace.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/placedCall.stest.ts
---
Both source system suites pass without longer timeouts and without leftover SQLite processes. The main root was in `watchTree`: when the parent of an external excludes file was missing, the synchronous `polling` subscription answer was taken for a file change, set `excludesWanted`, and repeated `git config` forever. Path re-resolution now starts from file events, and `polling`/`lost`/`error` states stay with the existing recovery owner. The minimal public-contract test was red on a 10000 ms timeout and turned green in 419–719 ms.

The runtime ownership gap of the mirror between build and registration-open completion is closed: dispose guards the whole handoff mask including its exit, and unregister belongs to the mirror scope until openWatch. The test interrupts resolve at subscription open, unblocks and waits for its close, checks not-served and a successful reopen. In addition `ProjectLifecycle.create` keeps the current graph-step rows in the birth transaction, so deferred opening of a new project does not run historical migrations.

Proof: hookPlace 3/3, placedCall 1/1 and two new polling/cancellation tests — 6/6, no residue. The first green run took 33.91 s whole; after review both source suites passed again in their system budgets with no leftover processes, the whole four-file run took 70.48 s under a parallel typecheck. Existing watcher 15/15, retry 1/1, projects and freshness 16/16. One read-only review found a cleanup window on mask exit and a twin subscription that never completes; both findings confirmed and fixed.

Opened separately: [[450375ea|the CPU budget of the two existing integration suites]] — 8689 and 14458 ms at an 8000 ms limit; timeouts are not extended. The full typecheck of the whole tree is not green yet because of others' unfinished changes (AgentRunner closing, ThreadObligations beforeClose, AgentHarness RegistryCollision); the checks found no errors in this delivery's files. The running server was not restarted or stopped.
