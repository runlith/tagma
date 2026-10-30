---
id: 01a18cab-8c51-72ae-a0eb-1a8d08285d75
title: Each hosted tool call costs the server ~500 SQL statements, ~10 write units and per-event thread re-projections, so many agents saturate its loop
ord: 140
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
---
On 2026-10-30, 11:21–11:31Z, 22 claude-code threads over ACP made 1,855 hosted tool calls. The server's one event loop saturated: it froze 139 times, 57 s in total, the longest 4.9 s. The interface stalled with it. Investigation thread `01a18c99-08a8-7d13-8c7e-283fb89b8bcd` measured this; its profiles are in that thread's scratch.

Every hosted tool call costs a fixed amount of server work: about 500 SQL statements, about 10 write units and about 4 thread re-projections. The ratio was the same in a calm window and in the busy one. Load therefore grows with agents × tool-call rate.

What changes concurrency is the waiting. A write unit holds the single writer permit while loop work runs (`platform/store/transaction.ts:106-171`), so `Store.permit.wait` averaged 437 ms.

The fan-out starts in the thread list. `threads/list/threadList.ts:384-401` (state events) and `:141-155` (phase changes) fork `watchedSummary(threadId)` on every event, with no coalescing per thread. Each call re-reads the row from SQL, including `OwnWork.owing` (three reads). `FileRoots.snapshot` runs on every command spawn: 393 runs in the window, 1.7 s on average.

Fix at the owners:
1. Thread projections — `ThreadList`, `ThreadSnapshots` in `packages/agent`, and the worktree listing — become incremental and coalesced per thread. An event marks its thread dirty. One projection per loop turn is built from the delta the event carries, and only while someone subscribes.
2. The bookkeeping of one tool call — run phase, journal append, terminal reserve and stop, snapshot — becomes one write unit instead of about ten. The store holds the writer permit only for its own statements.
3. `FileRoots.snapshot` and `changesSince` (`workspace/roots/registry.ts:345`) answer from the registry's revision instead of re-reading SQL on every spawn.

Done when a run of the same shape keeps the server loop free of multi-second stalls, and statements and write units per hosted tool call measurably fall. Measure with `read_performance` overview (`sql.execute`, `Store.transaction`, stalls) against this baseline.

Garbage-collection pauses as the stall mechanism are inferred from the profiles, not proven. `BUN_JSC_logGC=1` on an own instance settles it.
