---
id: 01a1a258-2c5d-7d9f-82a9-9a1c9fef2038
title: Restart liveness and the active channel prove process identity instead of trusting a reused PID
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a256-ef36-7a85-b768-259df9139dda",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19872-c87c-7775-8a20-a0b8c1342009
---
A killed server leaves active/restart records whose bare PID can later belong to another process. Make startup and channel selection verify a process witness or the held lock, including records issued releases wrote, and prove that stale records no longer prevent a fresh start.