---
id: 01a123ab-f138-71e5-a304-1358f3764a88
title: "A plugin removes the threads it gave birth to itself: the external caller archives a thread with its own key in bindings"
ord: 124
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-315a-7ac2-8df7-255b44e179d5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05f05ced9ad0
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/externalCaller.stest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
---
Poker measurement: rotating players every 5 deals left 81 idle threads — a plugin cannot remove the threads it created itself. A plugin's thread is an ordinary Tagma thread, so the path is the existing thread-archive operation, opened to an external `plugin:<id>` caller only for threads whose `bindings` carry that plugin's key; someone else's thread is refused. Landed in `5b38fd53ef`: `archive_thread` is open to an external `plugin:<id>` on exact match of the named thread's `bindings.plugin` with the id. Ownership is checked only at the root; the usual whole-group semantics stay. HTTP checks of the built server stand in the system layer: a running thread stops, the group leaves the live list and is restored by the operator; a foreign binding, a missing binding, another external caller, a wrong project and a missing thread refuse with no state change. Server typecheck clean, 11 system tests pass; file sample 9931 ms CPU / 6140 ms wall at system-ceiling 60000 ms wall. One independent general review Sol xhigh — no findings. The running Tagma server was not restarted; wiring the operation to player rotation stays in the poker package.
