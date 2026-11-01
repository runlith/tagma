---
id: 01a19872-c87c-7775-8a20-a0b8c1342009
title: Any Tagma process killed in any order at any moment leaves a restart fully working
ord: 35
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/execution-host
  - kind: dir
    ref: packages/watch
  - kind: dir
    ref: packages/sqlite-process
  - kind: dir
    ref: apps/tagma/server/src/executions
  - kind: dir
    ref: apps/tagma/server/src/platform/watch
  - kind: dir
    ref: apps/tagma/desktop
---
Killing any Tagma process — the window, the server, its sqlite-process children, the execution host logic, the execution-holder, the file watcher, any worker — by any means (quit, Activity Monitor, kill -9), in any order and at any moment, and then starting Tagma again yields a fully working system: agent commands run, the thread list loads, memory stays bounded.

No state a dead process leaves behind — a generation, an incarnation, an admission phase, a socket, a lock, a cookie file, a cursor, a pending request — may keep a restarted Tagma stuck. Every wait on another process is bounded, and a stale owner is replaced instead of adopted.

A restart that does not recover is a critical bug, fixed at the owner of the state that survived.