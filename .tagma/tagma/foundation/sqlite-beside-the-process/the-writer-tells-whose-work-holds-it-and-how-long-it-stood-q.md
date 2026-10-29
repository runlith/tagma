---
id: 01a14564-656e-7e40-9f43-ef362ba7e11f
title: The writer tells whose work holds it and how long it stood queryless in SQLite
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/SqliteProcess.ts
---
`Connections.writer` answers the writer lease's holder and the silence. Silence is the time since the start of the period during the lease when the writer has had no unanswered query.

Silence, not hold length, distinguishes a stuck lease. A long VACUUM or heavy transaction is busy in the engine. A lease taken and executing nothing is work waiting on something outside SQLite while all other writers of that database wait on it.

Silence and lease time run on the process's physical monotonic clocks, so machine sleep does not count as idling.
