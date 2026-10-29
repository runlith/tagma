---
id: 01a12374-c867-7738-999c-81b688df5ae7
title: Rule check time is visible by part — rule, queue wait, worker work and its phases — in telemetry and in the log, as it runs
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a122bd-84ed-7d7f-8953-10fb863f721a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a122f7-8f1b-7b82-bce4-24c785a257f0
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/waits.ts
---
**What.** The October 10 landing ran 141 s, 134 of them in `enforcement.judgement` with no single child span: which rule, how long it queued, and what the worker did are invisible. Needed: a span per rule (`enforcement.rule` with rule and builtin), a span per queue ask (`inspection.ask` with queue, ask kind, builtin, path count and queue wait) with `inspection.worker` beneath it; the worker's phases (`inspecting.*`: listing, blob reading, parsing, calibration, computing) are mirrored into the main process's spans in real time — the worker reports each phase's opening and closing, and the queue opens a span right there so they fall into place in the same trace. The queue knows the open phase even when the worker is busy and silent: such a case goes to the log with the phase and its length. The worker's journal takes open phases from the same spans instead of a separate wrapper.

**Done when.** On a real landing, `read_performance` shows `enforcement.rule` spans per rule and a breakdown down to worker phases; enforcement typecheck and tests are green.
