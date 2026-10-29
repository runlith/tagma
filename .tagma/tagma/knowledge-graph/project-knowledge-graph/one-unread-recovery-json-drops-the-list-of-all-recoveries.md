---
id: 01a130b1-5726-7fb5-9119-abbaed0bf21e
title: One unread recovery JSON drops the list of all recoveries
ord: 220
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1205b-860f-7204-8ede-30bea586c5d8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/recovery.ts
---
`graph/serving/recovery.ts` `list` (~99–104): one unreadable recovery file drops the whole list. Operator principle: one entry's failure is isolated in it and named (a typed failure beside the read ones), the rest answers as usual. Done: the test — one broken file, the list returns the rest and names the broken one.
