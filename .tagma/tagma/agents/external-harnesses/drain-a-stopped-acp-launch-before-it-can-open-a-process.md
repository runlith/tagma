---
id: 01a190d1-13f4-711c-9b1a-6fc3f480b831
title: Drain a stopped ACP launch before it can open a process
ord: 206
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1909d-4781-7130-94f7-d0167fb43c6f",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1907d-2830-75b1-ac39-cabd06872488
---
Fence and drain an unsent ACP launch before the stopped run closes, including a session open already in flight. Retire only a session created by that launch and not needed by another entrant; preserve existing sessions and later demand, keep waits outside journal and store locks, and prove stop, concurrent start, later turn and failure through the real ACP door.