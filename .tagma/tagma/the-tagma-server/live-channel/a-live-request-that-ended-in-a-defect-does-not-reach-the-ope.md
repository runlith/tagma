---
id: 01a15b87-fddb-7e4f-b689-e44daedba738
title: A live request that ended in a defect does not reach the operator's error list
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
`socket/live.ts` on an `Exit` with a defect only writes a warning `a live request ended by a defect` to serve.log, while under [[8c0ddf3f]] the place where the defect became the answer calls `defected` itself. On October 20 from 22:32:02 every `thread.subscribe` of thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186` failed with a defect (a call record unreadable by its own schema): the client showed "Reconnecting" forever, while `read_faults` stayed empty.
