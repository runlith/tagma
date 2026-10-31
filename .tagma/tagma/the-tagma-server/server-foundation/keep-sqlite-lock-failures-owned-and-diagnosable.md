---
id: 01a1941f-f2bb-77f3-9717-65501dc70298
title: Keep SQLite lock failures owned and diagnosable
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-8771d5cafaa8",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a131f9-1a04-7cf7-ab30-68f847835745
---
The archive-bench death had two parts: a WAL probe answering SQLITE_LOCKED took the store down, and the loss reason carried only SQLite's message, so the server's `onLost` printed "database table is locked" and exited with no act or code.

Current code no longer dies: `threadArchive.bench.ts --rounds=3` (fresh temp root, no execution host) completes 3 rounds at 3161/103/68 ms with no loss. Earlier fixes stand at the producers: EXPLAIN finalizes its statement (a8b08875), and BUSY/LOCKED from the probe or PASSIVE pass defer instead of losing the store (afba956c, `checkpointBlocked.itest.ts` drives a real LOCKED from an implicit cursor). The bench itself had rotted — thread birth refuses no-model-connected — and now writes its root row directly (84aef73b80).

Diagnosability fixed in 7aa29c797d: a fatal probe or pass failure names the statement (`PRAGMA wal_checkpoint(NOOP)` after a write, or `PRAGMA wal_checkpoint(PASSIVE)`) and the SQLite code and errno before the message. Which statement held the cursor in the historical run stays unknown: the bench's EXPLAIN was deleted before landing.