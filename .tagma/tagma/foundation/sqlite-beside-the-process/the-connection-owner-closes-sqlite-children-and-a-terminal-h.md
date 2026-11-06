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
  - kind: file
    ref: packages/sqlite-process/src/children.ts
---
Terminal signals arrive before the server manages to close its stores; managed stopping may also address children outside its group. So SQLite children have their own groups and, while their parent lives, keep serving IPC after SIGHUP, SIGINT and SIGTERM whatever they hold: a premature owner loss breaks shutdown and the data directory freeing. A child that judged its own lease by what it had already handled left in the gap between being handed work and handling it — a checkpoint process signalled before its Maintain arrived, or one still booting, took its owner down on a loaded runner.

A child therefore starts with those signals ignored: it is launched through `sh`, whose `trap ''` the exec'd Bun inherits until its own handlers take over, which shrinks the unprotected window from Bun's boot to sh's own start. Bun's spawn cannot set a signal disposition before exec, so that last window stays. The parent ends a child it no longer needs by closing its IPC channel and retires one by SIGKILL; on parent disappearance the child closes databases itself.