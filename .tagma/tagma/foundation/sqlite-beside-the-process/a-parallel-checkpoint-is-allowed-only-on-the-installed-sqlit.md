---
id: 01a127c8-442b-7600-9d5b-c533114f680f
title: A parallel checkpoint is allowed only on the installed SQLite with the WAL-reset fix
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
sources:
  - kind: file
    ref: packages/sqlite-process/src/artifact.ts
  - kind: file
    ref: packages/sqlite-process/src/Checkpoints.ts
  - kind: file
    ref: packages/sqlite-process/src/child.ts
  - kind: file
    ref: packages/sqlite-process/src/engine.ts
---
A checkpoint alongside a writer is safe only on an engine with the WAL-reset fix: upstream confirms it in [SQLite 3.51.3](https://sqlite.org/releaselog/3_51_3.html). For system Apple SQLite no backport established, so the SQL child picks the kit-installed engine before opening the database and refuses on another source identity; foreground auto-checkpoint disabling follows the same boundary. The source archive and its digest belong to the kit, and the host install and bundle carry its declared asset. Bun shares the selected SQLite engine across worker isolates, so server composition prepares and selects it before prewarming workers or assembling a cold runtime; otherwise telemetry can load the system engine first and prevent activity storage and graph readers from opening. A PASSIVE checkpoint runs as a separate shared runtime process: a held reader leaves WAL unfinished, its later pass does not hold the writer. COMMIT keeps the set FULL/fullfsync; stopping the checkpoint process on slot handover does not cancel already-durable WAL writes.
