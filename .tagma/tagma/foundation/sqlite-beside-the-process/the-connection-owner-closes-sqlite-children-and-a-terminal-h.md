---
id: 01a1239a-1e5d-7dfe-a96a-b95c710a8091
title: The connection owner closes SQLite children, and a terminal hangup does not interrupt its shutdown
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/child.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
Terminal signals arrive before the server manages to close its stores; managed stopping may also address children outside its group. So SQLite children have their own groups and, with a live parent and open connections, keep serving IPC after SIGHUP, SIGINT and SIGTERM: a premature owner loss breaks shutdown and the data directory freeing. The checkpoint process holds such a logical lease too, though Database opens only for the pass. Close and time-boxed retire stay with ProcessPool; on parent disappearance the child closes databases itself.
