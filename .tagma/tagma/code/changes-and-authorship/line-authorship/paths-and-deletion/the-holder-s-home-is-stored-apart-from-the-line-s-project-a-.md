---
id: 01a12741-f3fe-7f8f-9247-848dc2dc4356
title: "The holder's home is stored apart from the line's project: a restart or thread deletion does not retire its work in someone else's checkout"
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12726-9e16-7f6a-a8a2-1531ada88e6f
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261010185630_change_holder_home/migration.sql
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/store.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
---
A line's project belongs to the checkout, while its holder's existence, status, and name are judged by the "thread and its home" pair. These coordinates diverge when a thread works in another project; substituting the checkout's project would retire its live lines at startup as the lines of a deleted thread. The operator has no home. The migration adds only a column. The change-record owner brings writing/held through a partial index ahead of the startup readers; completed lines through a holder index ahead of the requested thread's history read. First the reader checks whether anything is left to bring; when nothing is, no writer is taken. The bring atomically takes the home from the thread record, and for an already deleted thread from the line's former project, preserving its history. After it, queries read one current form. Over several projects on one checkout, the former project is kept only on confirmed membership; without it the move refuses and rolls back, so as not to hand history to an arbitrarily chosen project.
