---
id: 01a179c9-bfb4-76ab-8a43-403d8936b239
title: Activity takes window and desktop failures via report_faults, holds groups incrementally, serves them to read_faults by origin and group, and reports lost only for losses that may hide rows
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
sources:
  - kind: dir
    ref: apps/tagma/server/src/activity
  - kind: file
    ref: packages/activity/src/fault.ts
  - kind: file
    ref: packages/activity/src/store/faulting.ts
  - kind: file
    ref: packages/activity/src/store/reading.ts
  - kind: file
    ref: packages/activity/src/store/writer.ts
---
Kit: fingerprint — a pure function as a separate entry, shared by window and server; a failure note with `origin`, `count`, `burst`, `firstAt`, `lastAt`, `context`, and `trail`, fitted to the fact's byte-serialization budget, server defects included; the `refused` type; a groups projection the writer and retention change in their own transactions, with Clear resetting it; a loss line carries the lost fact's kind and origin. Server: `report_faults` with entry ceilings, an activity `window-fault` per group with the sender's id, time by reception and age, answer after `ActivityLog.settled`, `activity-unreadable` refusal on unavailable storage; `read_faults` and the feed — `origin`, `refused`, `burst`, `context`, selection by `origin`, a group by `fingerprint`, a new `lost`, a page read from the projection, one feed frame for all subscribers. The operation description and [[8c0ddf3f]] fixed by the same change.
