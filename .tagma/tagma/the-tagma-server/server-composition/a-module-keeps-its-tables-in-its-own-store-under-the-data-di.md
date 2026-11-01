---
id: 01a19464-5da9-72ce-aa52-6e9c55501889
title: A module keeps its tables in its own store under the data directory, which a build lacking it never opens
ord: 43
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/ownStore.ts
  - kind: file
    ref: apps/tagma/server/src/composition/extensions.ts
  - kind: file
    ref: apps/tagma/server/src/composition/attempt.ts
---
A module that keeps tables of its own declares `stores` in its manifest — an id, the service key the opened store answers to, and its migration folder — instead of adding tables to the machine database, whose one migration chain every build carries. Composition opens each declared store at `<data>/stores/<id>.sqlite` on the machine store's process pool and durability, before the installation lifetimes of modules outside the core, and the store's key joins the context those lifetimes, the serving tier and the doors take.

A separate file per module is what lets a build that lacks the module open the same data directory: nothing of that build reads or migrates the file, and the machine store's chain never meets migrations it does not carry. The id is checked across modules like every other manifest collection, and the subdirectory keeps a module's id from colliding with the core's own databases.

The transition attempt covers `<data>/stores/` by directory, not by reading the parts: the CLI enters and rolls back the attempt before it loads the build's modules, and a build that lacks a module still returns its file as it stood. Taking the copies lists the databases standing there; every later step — a restart of the attempt, the rollback, the judgement whether the release before has written since — covers only the databases that have a copy. A store a failed start created after the copies were taken therefore stays where it is and never decides whether the predecessor's writes are kept.

In a cut the chain is carried at `bin/stores/<id>` and read from there when it stands beside the bundle; from a checkout the declared folder is read.
