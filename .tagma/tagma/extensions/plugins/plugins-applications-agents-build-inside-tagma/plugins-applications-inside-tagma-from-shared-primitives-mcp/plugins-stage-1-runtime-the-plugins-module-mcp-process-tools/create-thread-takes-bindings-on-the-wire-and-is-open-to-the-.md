---
id: 01a12306-efba-7a0e-94d7-05eed6340847
title: create_thread takes bindings on the wire and is open to the outside caller
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-315a-7ac2-8df7-255b44e179d5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/birth/acts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/creation.ts
---
The spec's “Plugin-born threads” section. `bindings` is already in storage (`threads/store/mandate.ts`), missing on the wire (`threads/contract/wire/creation.ts`). An outside admit wakes the thread; the limit is the existing thread budget.

Done when an outside `plugin:<id>` caller creates a thread with `bindings` and they read back from the thread's row.
