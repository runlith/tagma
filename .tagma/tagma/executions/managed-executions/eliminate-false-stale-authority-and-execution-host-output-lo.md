---
id: 01a12c87-3ce1-77a1-b29c-cb5e536ffde9
title: Eliminate false stale authority and execution-host output loss
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4df8ba91d8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12a17-3049-7dba-9498-66939a90905a
---
Authority Observe/Await now holds a stable projection of the admission; cleanup rootUse keeps the authorized read. Subscription queues survive Ended and wire close until reader release, and a read refusal names the execution and stream. Two root tests went red→green; executions and server typecheck, 16 focused tests, 8 admitted-git tests and 2 real-host tests green. Its own tagma:try confirmed ended/exit7 and exact stdout/stderr, then stopped. Retained-stdout eviction losses at grep/glob were handed to [[6a5ec421|streaming reads]] and eliminated by its 39035be8b2 delivery; the historical produces-directory needs its own separate check.
