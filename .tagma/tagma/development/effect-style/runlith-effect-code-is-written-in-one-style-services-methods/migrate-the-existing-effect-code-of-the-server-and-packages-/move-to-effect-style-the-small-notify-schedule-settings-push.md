---
id: 01a13be8-c38c-7f61-871f-39a7ffd9b673
title: "Move to Effect style: the small notify, schedule, settings, push, commit-steps, thread-record modules"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be9-049f-7acf-80f4-ecb0b2d59443",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/commit-steps
  - kind: dir
    ref: apps/tagma/server/src/notify
  - kind: dir
    ref: apps/tagma/server/src/push
  - kind: dir
    ref: apps/tagma/server/src/schedule
  - kind: dir
    ref: apps/tagma/server/src/settings
  - kind: dir
    ref: apps/tagma/server/src/thread-record
---
A trial migration wave, a batch of small `apps/tagma/server/src/` modules: notify, schedule, settings, push, commit-steps, thread-record (measurement 2026-10-14: ~55 sites together). Proof is zero effect-style findings for each, typecheck and tests green, spans preserved.
