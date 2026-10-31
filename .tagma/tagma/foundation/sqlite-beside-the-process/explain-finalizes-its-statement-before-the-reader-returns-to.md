---
id: 01a16cdb-5d0c-7b08-b8ef-0a6ca8b08875
title: EXPLAIN finalizes its statement before the reader returns to the pool
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
In the installed SQLite `EXPLAIN` and `EXPLAIN QUERY PLAN` leave VDBE active after `SQLITE_DONE`, while Bun `Statement.all` and `values` do not call reset after an answer. Such a handle holds the next read's snapshot on the same connection even in autocommit: `inTransaction` stays `false`, but the writer's fresh commits are no longer visible. So these statements are not kept in the query cache and finalize after a result or failure; ordinary SQL statements keep the cache.
