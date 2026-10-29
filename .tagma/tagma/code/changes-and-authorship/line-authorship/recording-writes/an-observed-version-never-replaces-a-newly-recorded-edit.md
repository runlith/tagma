---
id: 01a12cb1-a7e8-7968-831b-49beef27fa51
title: An observed version never replaces a newly recorded edit
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12ca1-8f79-72b3-90ab-0121f617c346
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/folding.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/projection.ts
---
A snapshot of the starting base or an external gap keeps bytes but proves no version authorship. A new record whose result matched such an observation applies with its own hunk; authorship recovery uses the snapshot taken by a recorded transition. This keeps the owner of a repeated edit after an early line leaves while its undo still stands in the record. An external recovery with no new line keeps returning the earlier marks. The initial base identity remains immutable: a typed return to its bytes on a branch subsequently left behind cannot replace HEAD's base identity. Otherwise an undo/redo round trip makes the old method's deletion anonymous and moves or duplicates lines in the landing slice. A transition still belonging to the current branch keeps its recorded ownership.
