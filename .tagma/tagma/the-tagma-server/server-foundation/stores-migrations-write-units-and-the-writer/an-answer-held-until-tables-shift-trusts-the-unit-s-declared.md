---
id: 01a136cb-2848-7183-bbb1-472dbaf26b62
title: "An answer held until tables shift trusts the unit's declared write set: a write past the declaration leaves it stale"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/moves.ts
---
The store's `TableMoves` learns of table shifts from the transaction. After an outer unit commits, before its tail commits, it marks tables from the `reach` write set of that unit and of every successful nested one, plus tables the write reaches through consequences: FK cascades and triggers (`movedTables` over the store's consequences). A unit with a string operation instead of a write set, and a write whose consequence isn't parsed, shift all tables at once. `TableAnswers` holds the last read answer until its tables' revision shifts. So the command feed on every host pulse takes terminal marks and rows from memory, and SQL reads only after a write to `command`, `command_wait` or `terminal` — including project-delete cascades.

The boundary: correctness rests on complete declarations. While write sets are still being collected, an off-declaration write in production only prints ("reported, not refused"): such a write changes rows without shifting, and the holder answers stale until the next declared write to the same tables. Raw writes through `store.db` outside a unit produce no shift. An answer may be held only over tables written by units with a full declaration.

Inside an open unit the holder neither answers nor remembers anything: reads there go over the transaction connection and see its uncommitted rows, which rollback won't shift. The revision is taken before the read and the answer stored only if it didn't shift during the read: a commit arriving mid-read marks itself after itself, and the next call reads again.
