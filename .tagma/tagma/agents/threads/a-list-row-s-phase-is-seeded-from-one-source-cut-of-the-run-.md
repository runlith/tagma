---
id: 01a1976a-124c-7499-92ce-35e6b40c3c69
title: A list row's phase is seeded from one source cut of the run its row facts name
ord: 146
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
  - kind: relates
    to: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/phase.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
The list follows the phase and open calls only of shown rows, and only of the run their row facts name; it never follows every thread's published state. Starting to follow opens one source cut (`HarnessThreads.readCut`). On that cut's unit the projection cursor, and any row not yet held, are read first, beside the cut's active run, its stored open calls and the live view, so the row and its phase seed come from one snapshot.

Live events heard while the cut is read are dropped when the cut's live position already covers them (same incarnation, sequence at or below the cut's); applying them after the cut would bring back a call the cut shows settled. A cut can see a successor run before the row facts deliver it, because a reader may see a commit before the writer's answer reaches the server. That successor's view and what is heard of it are kept until the facts name the run, never spliced into the run being followed. A run the facts select without such a kept view takes a fresh cut.
