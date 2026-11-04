---
id: 01a1a765-e74d-79f4-83e7-450fb98619f1
title: The SQLite kit selects its engine through a macOS-only Bun mechanism, so no database opens on Linux
ord: 24
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a127c8-442b-7600-9d5b-c533114f680f
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/sqlite-process/src/engine.ts
---
The kit picks its SQLite engine with `Database.setCustomSQLite` (`selectEngine` in `src/engine.ts`) and then demands one exact `sqlite_source_id()`. That selection is the macOS mechanism for replacing Apple's system SQLite, which lacks the WAL-reset fix; on Linux Bun answers `false` and the kit throws before opening any database.

Observed in CI run 41866031428 (ubuntu-latest, Bun 1.4.4, commit 06131e7f0f): every integration suite on Linux fails between tests with `The supplied SQLite engine could not be selected before opening a database.`, before a single test runs — `checks/law`, `packages/activity`, `packages/agent`, `packages/adapter-cursor`, `apps/tagma/inspection` and the rest. One OS's way of getting a fixed engine stands in the shared kit, so the whole product's storage is unusable off macOS.

Done when the kit states what it needs of the engine (the WAL-reset fix) and a per-OS adapter supplies an engine that has it — on macOS the kit-built library selected before first open, elsewhere whatever proves the fix, built or bundled — with the shared code naming no OS, and the integration suites start on a Linux runner.

Added by the OS audit, unclear: `src/artifact.ts:64-84,107` is the kit's own native build recipe and branches on `darwin` and `linux` (install name and `-arch` on darwin, `-dynamiclib` against `-shared -fPIC`), and `src/engine.ts:12` keys the verified build by `process.platform`. It is the package's build, but the per-OS flags sit in the one shared file next to the engine contract; the owner decides whether the build recipe becomes per-OS adapter data with the engine selection.
