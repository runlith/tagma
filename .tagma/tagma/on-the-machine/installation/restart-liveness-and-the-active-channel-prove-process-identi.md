---
id: 01a1a258-2c5d-7d9f-82a9-9a1c9fef2038
title: Restart liveness and the active channel prove process identity instead of trusting a reused PID
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a51-7739-a251-86d1ad1d1996",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19872-c87c-7775-8a20-a0b8c1342009
---
A killed server leaves active/restart records whose bare PID can later belong to another process. Make startup and channel selection verify a process witness or the held lock, including records issued releases wrote, and prove that stale records no longer prevent a fresh start.