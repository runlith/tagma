---
id: 01a14de3-3654-7873-a6ee-91fbc2ddbc0a
title: Cost an adapter reports after the run end lands on that run once, on its own evidence
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/thread/keyed.ts
    symbol: chargeKey
  - kind: symbol
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
    symbol: charged
---
The core can finish an adapter's run before the vendor reports its cost: a stop on an open question, the reaper, grace. The vendor already charged that cost, so `measured` and `ended` are not dropped for a finished run: they write `thread_run.usage` and `cost` through `charge` in any status, with no journal events.

A transition record under `chargeKey` holds idempotency (the `charge` operation). The `report` operation's keys do not fit: they are deleted at run end and trimmed by the window, so a repeat after the end would pass as new. `ended` always writes its remainder under one label with a constant digest, before `finish`, so the run-end record already carries it, and an `ended` repeat (including after adoption) adds nothing.

While the run is going, `measured` lands under the same `chargeKey` of its own evidence (the vendor message id): the agent may send the same `usage_update` again at a new stdout position, and a repeat after the run's end must find the same record. Cost: one record row per request while the thread lives, next to the `step-finished` event the journal keeps the same way. Late cost reaches `thread_run.usage` (tree budget, snapshots) but not the run-end record: that record is the cost known at the moment of the end.
