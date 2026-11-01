---
id: 01a19888-a2c9-79bc-a4ba-8dda8e9b2604
title: A statement's answer past the reply budget is refused in the SQLite child before it crosses to the server
ord: 23
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19888-3749-73c6-8c8d-4675e44d6479
sources:
  - kind: file
    ref: packages/sqlite-process/src/host.ts
  - kind: file
    ref: packages/sqlite-process/src/channel.ts
---
The child measures every `Run` answer with the logical payload measure the cost ledger uses. Past `REPLY_BYTES` it fails the statement, and a write in an implicit capture unit rolls back with it. The server turns the refusal into a `SqlError` whose cause is `ReplyOversized`, carrying the statement's census fingerprint and summary, the size and the budget. The connection keeps serving. The measured size rides every reply, and the ledger takes its response bytes from it without walking the rows a second time.

The budget, 256 MiB, sits far above every read the store pages. Envelopes and selections share 1 MiB, journal and transcript pages take 1 MiB, rollout carry units 4 MiB, and a file an agent hands over is at most 64 MiB. An answer is held about three times at once: as values in the child, as the pipe's copy, and as values in the server. The budget therefore keeps one statement's transient memory under about 1 GiB, which an 8 GiB machine still carries while serving. A read that approaches the budget is a reader that needs paging. The 5 GB thread-list answer that took the server down would have been refused at a twentieth of its size.

The guard keeps an oversized answer out of the pipe and the server, not out of the child. `bun:sqlite` cannot step rows in array shape. Stepping in object shape doubles a small statement's cost and loses duplicate column names, which joins produce. So the child materializes the answer before it measures it. `Export` serializes the database file and is no `Run`, so the budget does not bound it.
