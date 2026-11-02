---
id: 01a19cd2-ce4e-74a4-931b-7ff8f32ca16e
title: Thread standings read clocks from a covering index and outcomes through the terminal predicate
ord: 150
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19ccc-a70b-7b1c-a454-370b81abda85
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/store/kernel.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/drizzle/20261102151500_thread_clock/migration.sql
---
A thread's activity timestamp shares a row with large prompt and state payloads, so a narrow clock lookup must be covered without loading that row. The outcome selector uses the same literal terminal predicate as its partial index: parameterizing that fixed set prevents SQLite from matching the index and makes each thread sort its run history. Delivered keep-warm runs remain excluded from the selected outcome.