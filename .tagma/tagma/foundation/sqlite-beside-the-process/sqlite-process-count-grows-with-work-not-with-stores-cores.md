---
id: 01a10284-da13-7e0c-9742-a433917adeb8
title: SQLite process count grows with work, not with stores × cores
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a102a8-1775-75af-9d96-95230dc0838f",
    "status": "done"
  }
edges:
  - kind: waits-on
    to: 01a10284-da13-7e0c-9742-a4294316f802
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/SqliteProcess.ts
---
**What.** SQLite process count grows with work, not with stores × cores.

**Why (perf audit of 2026-10-03).** `packages/sqlite-process/src/SqliteProcess.ts:42,100,143` — `machineReaders() = max(2, availableParallelism())` per store; `connection.ts:174` — `Bun.spawn` per connection. Processes = stores (machine + mirror per served tree or worktree + global) × (1 + readers); each statement an IPC round-trip with row serialization on the main thread. Measured: 5.5 min after boot the server has 17 sqlite processes and 1050 MB RSS; `db.readers.busy=10` at `queued=0` — the pool not exhausted.

**Direction.** The package owner's decision: the readers ceiling does not multiply by cores per store; a shared pool or worker threads instead of a process per connection. Machine range per [[fe83acfa]].

**Done when.** The shared reader pool capped by machine capacity regardless of served tree count, and read latency on the same readings not substantially worse. Per the operator's 2026-10-03 clarification, writers keep a separate child per store: one store's heavy write does not delay another's commit. Final boundary: writers(stores) + K readers; writer and SQLite-data RSS stays store-dependent, the stores × cores multiplier for reader processes removed.
