---
id: 01a15f38-17c3-7a9c-8f59-54a1a54fe2fb
title: "Client: the thread surface's Esc, the session's single stop, Enter without others' awaits"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f37-f5c3-7c80-a3c8-f3e0e3244f86",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d9511b80d7
---
Implementation of [[511b80d7]] in `packages/chat-ui/src` and `apps/tagma/app/src/lib/features/threads`: Esc belongs to the thread surface, a stop is a session-scoped act with a "Stopping…" state and a visible `ThreadStop` answer, a stop is available while the feed reconnects, Enter awaits no settings records or other sends' loads; `stopWhenRunStarts`, `withdrawals`, and the thread-list second stop leave.
