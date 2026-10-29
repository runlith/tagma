---
id: 01a12795-3eca-786c-aa8b-b5e115a15cc2
title: Orderly SQLite handover closes admission and waits for durable transactions until the writer frees
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/SqliteProcess.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
The runtime owner requests handover through `Handover`; ordinary close stays as before. `Connections.handover` closes new admission and waits for the writer lease, so a started transaction reaches COMMIT or rollback. The separate own writer ends without native Close: committed is already durable in WAL, so no checkpoint needed for handover and none in the owner gap. Success requires the child's real exit; foreign handles of the shared readonly child are kept. A planned handover does not call `onLost`, with which the host answers an unexpected database loss. The process owner sets this wait's deadline: the Tagma server, not closed within a minute of the signal, exits itself, and the uncommitted transaction rolls back.
