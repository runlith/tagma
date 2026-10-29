---
id: 01a17321-2895-71ed-b498-9b2e5d64a5d1
title: Codex cut via thread/fork in codex app-server root preparation — whole and to-turn
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17339-47a9-7fd1-9a5c-4b64b533ad89",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b29748d138f
  - kind: waits-on
    to: 01a17321-2895-71ed-b498-9b2cefc51f58
---
Codex root preparation gains a fork form: the experimental API in `initialize`, `thread/fork {threadId, beforeTurnId}`, the new root's turn ids via `thread/read`, then `codex resume Y` at the thread's place.
