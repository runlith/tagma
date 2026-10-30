---
id: 01a15117-7946-7ad0-9302-0c2109e5d6f9
title: A change affecting agents reaches working ones by notification at their next step and does not wake idle ones
ord: 101
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/turns
  - kind: dir
    ref: apps/tagma/server/src/threads/turns
---
Covers any setting or state an agent's work depends on: child models, review policy, delegation, connected accounts. An idle agent picks up the current state on its next run.
