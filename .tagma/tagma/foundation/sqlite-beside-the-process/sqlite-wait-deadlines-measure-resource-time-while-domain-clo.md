---
id: 01a1236e-f6dd-73ea-a922-bedc85ac3fd7
title: SQLite wait deadlines measure resource time, while domain clocks stay with the caller
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
The SQLite child and its IPC keep running in real time when the caller shifts domain clocks. So writer waiting and the Close deadline use a physical clock, and statement duration and its watchdog physical monotonic time; the domain Clock stays inside the transaction body. Otherwise a TestClock shift of a day exhausts the writer queue deadline and yields SqlError for a live query, and the watchdog plays virtual intervals for a statement still running in the child.
