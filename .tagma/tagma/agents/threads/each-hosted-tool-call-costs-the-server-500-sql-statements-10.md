---
id: 01a18cab-8c51-72ae-a0eb-1a8d08285d75
title: Each hosted tool call costs the server ~500 SQL statements, ~10 write units and per-event thread re-projections, so many agents saturate its loop
ord: 140
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
On 2026-10-30, 11:21–11:31Z, 22 claude-code threads over ACP made 1,855 hosted tool calls. The server's one event loop saturated: it froze 139 times, 57 s in total, the longest 4.9 s. The interface stalled with it. Investigation thread `01a18c99-08a8-7d13-8c7e-283fb89b8bcd` measured this; its profiles are in that thread's scratch.

Averaged over the installation, each completed hosted tool call came with about 500 SQL statements, about 10 write units and about 4 thread re-projections, in the busy window and in the calm one after it. Two whole-kept `read` call traces carry 123–160 statements and 3 write units of their own; the rest is reactive work outside the call's trace and background, not yet attributed. Load grows with agents × act rate.

What changes concurrency is the waiting. A write unit holds the single writer permit while loop work runs (`platform/store/transaction.ts:106-171`), so `Store.permit.wait` averaged 437 ms.

The fan-out starts in the thread list. `threads/list/threadList.ts:384-401` (state events) and `:141-155` (phase changes) fork `watchedSummary(threadId)` on every event, with no coalescing per thread. Each call re-reads the row from SQL, including `OwnWork.owing` (three reads). `FileRoots.snapshot` runs on every command spawn: 393 runs in the window, 1.7 s on average.

The fix is specified in [[2afe6fec]]. Its review rejected this task's first fix list: one write unit per whole tool call would cross host effects and ACP acknowledgements, a projection rebuilt per loop turn from event deltas loses the snapshot's exact journal position, and file-root probes stay as acquisition-time identity checks. Done when that spec's acceptance holds.

Garbage-collection pauses as the stall mechanism are inferred from the profiles, not proven. `BUN_JSC_logGC=1` on an own instance settles it.
