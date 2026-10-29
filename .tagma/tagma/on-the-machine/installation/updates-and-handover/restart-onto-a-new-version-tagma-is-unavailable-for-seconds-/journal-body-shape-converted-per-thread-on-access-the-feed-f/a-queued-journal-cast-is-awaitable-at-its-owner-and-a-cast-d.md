---
id: 01a188b7-9f6d-7693-86a7-28f2011b874a
title: A queued journal cast is awaitable at its owner, and a cast deferred by a use resumes after the last use
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1889a-6037-78a2-8d09-8777b74bd780",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
---
`rolloutWhole` runs a queued cast of an offloaded thread in the background; a commit the thread's use refused stays owed and runs again at the last release. Nothing lets a caller learn when the cast standing for a thread settled, so the deferral cannot be proven without a race. The owner registers each requested pass at request time and answers an effect awaiting it, and a test proves through it that a cast requested inside a use stays owed and lands after the use ends.