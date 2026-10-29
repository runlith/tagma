---
id: 01a127c9-c76e-7e8a-a4ef-2ac5c40f52bc
title: Telemetry persists across openings of one schema and is recreated on schema change
ord: 23
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/schema.ts
  - kind: file
    ref: packages/performance/src/SegmentRing.ts
---
The performance ring is a spendable record of the process, so a SQLite schema change deletes the whole ring with the loss counters; no data is carried over. The writer compares the declared DDL against the catalog and segment schema without walking the records. Opening the same schema keeps records and counters; a missing segment is a typed refusal, not a reason to delete what remains. The watcher recreates nothing. The file at the configured path is deleted only after the telemetry tables are recognized; someone else's database is preserved, a non-SQLite file stays with a diagnostic.
