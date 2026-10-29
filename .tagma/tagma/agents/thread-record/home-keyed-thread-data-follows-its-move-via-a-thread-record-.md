---
id: 01a17f4f-38b5-768e-89bf-0c4a58cb2fff
title: Home-keyed thread data follows its move via a thread-record/home-followers contribution, in one write with the move itself
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f1c-bd6b-776b-a00f-dc252a0c2131
sources:
  - kind: file
    ref: apps/tagma/server/src/thread-record/contract/service/homes.ts
  - kind: file
    ref: apps/tagma/server/src/threads/homes.ts
---
Moving a thread to another project is one write unit: all contributions' admission, `ThreadRecords.rehome`, and all contributions' following commit together or not at all, so no half-move happens (the thread's line in B; its lines, team rules, or places under A). An owner of home-keyed "thread and its home" data declares a contribution at the home owner's `thread-record/home-followers` point — its tables, `follow`, and where needed `admit` — and `ThreadHomes` in threads executes them all; central code does not change for a new owner. A missing contribution means its lines after the move are judged by the old home: the change record's retained lines would read as a departed holder's lines, the thread's team rules would not be found in B.

`admit` refuses before any write: executions (terminal, running command, unresolved custody handover) belong to the project where they run, so a thread holding them keeps its home (`executions-held`). A running thread moves inside the kernel-step boundary commit, so the contributions' tables enter the transition-write set (`kernel.ts`); a contribution with a new table extends it too.
