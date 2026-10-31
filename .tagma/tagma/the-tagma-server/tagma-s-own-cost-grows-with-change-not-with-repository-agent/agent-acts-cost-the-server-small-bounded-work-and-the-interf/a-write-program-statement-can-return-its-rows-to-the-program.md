---
id: 01a190e0-0fcb-7e1a-9b73-e512ff99d338
title: A write program statement can return its rows to the program's owner after commit
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19024-ade6-7491-8821-17c789714d92",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/programs.ts
  - kind: file
    ref: packages/sqlite-process/src/programs.ts
---
Spec A's durable per-thread change revision needs `insert … on conflict do update set change_rev = change_rev + 1 returning change_rev` inside a write program. The increment must stay unguarded, because writers of a thread's readable storage outside its journal lane (run progress ticks, heartbeats, session facet writes, inbox puts from other threads, titles) would turn an equality guard into constant conflicts, as `lease_beat` did.

Programs carry only writes without RETURNING. A statement flagged to return rows has the child add them to the program's per-program answer. `Units.program` hands those rows to an after-commit continuation of the program, and an interactive unit's statement offers the same shape. A program that conflicts or fails hands nothing. Asked for by the projections work (thread 01a190c6-c2c4-7288-bc4c-2bd289f7cc4a); not needed for its first slice.