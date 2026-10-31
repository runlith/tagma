---
id: 01a1908c-f29c-774c-b61b-0afc05fffb8b
title: A store write program is planned from guarded reads and falls back to an interactive unit when it cannot be planned or a guard refuses
ord: 38
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19024-7ec1-7479-b7dc-1386eb690904
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/programs.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/units.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/crossing.ts
---
`Units.program` collects a write unit's statements instead of running them: a write without RETURNING, optionally with the change count it must produce, and guards — selects with the row count the decision relied on. The decision's own reads go through `units.read`, outside the program, and the guards re-check at commit what those reads saw: a guard miss or a uniqueness refusal answers `ProgramConflict`, and the caller decides again in an interactive unit, so a stale read costs one redecision, never a wrong write. Work that needs a value back from a write, or reads through the program's own unit, cannot be planned: `programWriteUnit.run` dies `ProgramUnplannable`, `planned` and `inProgram` answer null, and the caller writes the same work in an interactive unit. A caller with a program form therefore keeps its interactive form until no hot path falls back to it.

A program opened inside another joins it and commits with it. One opened inside an open interactive unit of the same store runs at once under a savepoint, its guards checked there. An interactive unit opened while a program is being built is refused (`UnitInProgramRefused`): its statements would commit before the program they belong to.

The cost ledger counts a program under `programs` and its request bytes, never under `statements`, so a root's `statements` keeps equalling the `sql.execute` spans its loop ran. After-commit tails run in order once the batch commits, and the declared write sets shift their tables then, as for an interactive unit.

A program carries no replay protocol: Tagma's store exits when its writer child is lost, and the server restarts from committed state. An owner whose program may have committed unanswered recognizes it there by its own durable evidence: the journal event id, the `thread_call` key of a kernel transition, the ACP protocol cursor. A program's identity string is made from that evidence, so its span and a conflict name the same act.
