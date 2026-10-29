---
id: 01a17b46-3468-743a-b806-e20a1c68fa2e
title: "Thread, terminal, and executions tests wait idly: remove the wait at the owner"
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b4d-1304-718f-a9cb-eb550b273ddf",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
From the same run on 8 workers. This area's files and their in-body waiting: `threads/terminalHistory` 16 s, `executions/host/recovery` 12 s (1.6 s CPU), `threads/threadMove` 12 s, `threads/terminalConformance` 12 s, `threads/protocolRoad` 11 s, `threads/birthAuthority` 10 s. Find what each waits for and remove the wait at the owner.
