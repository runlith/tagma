---
id: 01a19499-b57e-7aad-87ee-e1f6cd6c3a69
title: State a module keeps per store unit is released when the unit ends, never at the unit object's collection
ord: 41
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/life.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/programs.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/units.ts
---
A unit object can outlive its work: a closure, a captured `ThreadAt`, an `Effect.fn` call's arguments or a retained fiber may still reference it after its read or transaction finished. So per-unit state that a module keys by the unit — a memo of what it read inside the unit, a claim it took for the unit's writes — must not wait for the unit's collection: a folded history held per unit then stays resident outside any bound, and a write that never settled keeps its thread's `HeldHistories` claim, so every later read of that thread loads the whole history again.

`atUnitEnd(unit, release)` runs `release` when the store's unit ends:
- a read unit, when the work given to `units.read` ends;
- an interactive write unit, after its outermost transaction's commit and its after-commit tails, or after its rollback; a nested unit of the same store ends with that outer unit, because its tails run there;
- a program, after its submission and tails, or its failure; one built inside another program, or joined into an open unit, ends with its host; `programWriteUnit` ends with its program.

An end after the tails matters: a claim released before the after-commit `settle` would let a reader publish the pre-commit history while the writer's own settle is then refused. A unit the store did not make has no end and keeps the release to its collection; a unit already ended releases at once, so state asked for after the end is never kept.
