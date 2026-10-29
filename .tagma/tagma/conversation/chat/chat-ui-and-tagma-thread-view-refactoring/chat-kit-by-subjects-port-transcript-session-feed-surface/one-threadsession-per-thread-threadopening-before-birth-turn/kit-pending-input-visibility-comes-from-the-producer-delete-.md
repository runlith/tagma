---
id: 01a11ae3-2dbd-7578-825c-965d011935ff
title: "Kit: pending-input visibility comes from the producer — delete waiting/withheld and arrivals placement by occurredAt"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-470f-7498-99ae-69eac457afe4
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e0eb9c2129
---
Consumer half P4 from [[c3436715]]: the producer (impl-events) serves `ThreadPendingInput.arrived` as `ThreadSignalEntry[]` with a fixed place — after the journal, before the open tail, in arrival order; a read arrival arrives as an entry with the same id in the same state event.

Do in `ChatFold`: delete `waiting`/`withheld`, the `pending.steers → signalEntryId` mapping, `entryFromArrivedWords`, `arrivalAt`; arrivals are a projection of state in their own place, one batch per event.

Done: test — an arrival is visible before it is read, after reading exactly one row with the same id without flicker; a steer is visible from its own entry.
