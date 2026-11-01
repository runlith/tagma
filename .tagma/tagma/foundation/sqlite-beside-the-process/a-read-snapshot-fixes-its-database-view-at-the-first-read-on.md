---
id: 01a1957d-a54d-7d7a-80da-00655cb248b3
title: A read snapshot fixes its database view at the first read on a borrowed reader
ord: 21
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: packages/sqlite-process/src/ReaderPool.ts
  - kind: file
    ref: packages/sqlite-process/src/SqliteProcess.ts
---
Deferred BEGIN does not fix a SQLite read view, so a revisioned cut must read its revision before other facts. Queries participate through the borrowed reader; ordinary read declarations may acquire different connections. The snapshot takes no writer lease and refuses owners without reader lanes; SQLite’s journal mode still determines whether concurrent writes can commit. A failed transaction control removes its connection from reuse so an unknown transaction state cannot become another caller’s view. Journal files and live-memory projections remain outside this database cut.