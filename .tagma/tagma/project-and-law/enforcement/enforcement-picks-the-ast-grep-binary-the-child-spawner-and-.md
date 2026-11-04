---
id: 01a1a76d-609a-7eae-a622-8d45c64e702d
title: Enforcement picks the ast-grep binary, the child spawner and directory fsync by OS
ord: 172
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/ast-grep.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/journal.ts
---
Three shared enforcement files branch on the OS.

Read at ee24295b8e:
- `programs/ast-grep.ts:12-16` builds the `@ast-grep/cli-<platform>-<arch><suffix>` package name (`-gnu` on linux, `-msvc` on win32) and the `.exe` suffix from `process.platform`.
- `workers/inspecting.ts:63` the worker's spawner is the Bun child-process layer on win32 and `bunSpawner({ detached: true })` elsewhere.
- `commits/journal.ts:160` the parent-directory fsync after rename is skipped on win32.

Done when the native binary lookup, the spawner and directory durability are contracts filled by composition and the module names no OS.