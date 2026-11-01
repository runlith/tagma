---
id: 01a1976a-11c1-7ce3-a4f9-8912ebba7e6c
title: Followed thread rows change from committed row facts in memory, with exact cuts for new followers and gaps
ord: 145
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/rows.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/inputs.ts
---
`ThreadRows` keeps the raw summary inputs only of rows someone follows — list windows and audiences, operator attention, and the waiting threads keep-warm judges — and applies each committed row envelope to them in memory, so a held row changes with no storage read. It also keeps two narrow sets for every thread: the running threads with their placement root, and the threads owed their own work, each with its ancestry path; keep-warm's waiting answer and the graph-copy holds come from these.

Values a patch cannot carry — the outcome run (by run id among endings, excluding delivered keep-warm runs), the latest run with its keep-warm ping, the newest unrewound message position for recap status, owed membership, ancestry, the active run and a thread's place — are recomputed by indexed selectors at the writer's seal, once per affected thread and only when a source column they read changed. A deletion that changes a winner is therefore an ordinary fact, not a gap, and a debt that moves from a call or command to a queued ending inside one unit never shows `owes` false between them.

A row that starts being followed is read at an exact cut: the projection cursor is the first statement of one reader snapshot, and envelopes after it are replayed from a bounded ring of recent envelopes; a cut older than the ring reads again. A delivered gap, or a cursor that does not follow the last one, rebuilds the narrow sets and every held row from one snapshot, after which the list resyncs its windows. A birth whose record, native thread and mandate arrive in one envelope is built from that envelope; any other newly followed row is read once. A row read on a caller's behalf is returned to that caller and told to no subscriber, since the caller announces it; only rows a retainer wants and nobody read are told when they arrive.

A heartbeat-only run patch updates the held row and tells nobody unless the row's `life` class flips: the list never shows the heartbeat, and announcing it would send every followed running thread every beat.
