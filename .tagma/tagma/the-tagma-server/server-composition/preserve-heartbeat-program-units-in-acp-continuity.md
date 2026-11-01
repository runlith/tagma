---
id: 01a195df-2fe4-7e48-a333-bff93019536b
title: Preserve heartbeat program units in ACP continuity
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a195e0-5a72-7002-bde6-a438ca732425",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19107-6f1f-79c8-ad79-582909e79b08
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/protocolContinuity.itest.ts
---
Repair the active-retry continuity fixture's run-store adapter: it forwards only run ids and time, dropping the program unit added to `writeHeartbeats` by `ac74a52989`. The resulting `UnitInProgramRefused` prevents its heartbeat signal and hangs the case. Clean detached worktrees with the same single-file seed-1 command establish the boundary: parent `af0bdacbe35` passes 8/8 in 38.6 s; `ac74a52989` and committed HEAD `d14de8a7ab` pass five cases, then fail active retry at 360 s with that refusal. Preserve the full unit and acknowledge the observed heartbeat only after its commit; retain the retry, hold, text and tool-input assertions. Verify the whole continuity file on seeds 1–3 and determine whether any `CursorRefused` failure remains independently; a warning in the passing parent is not a failed case. No live server actions or broad test runs. The detached comparison concerns this fixture regression, not the earlier throughput regression.