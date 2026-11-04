---
id: 01a1a76d-601b-7b33-9583-c50b0a215bf7
title: The Muse adapter prepares its home by enumerating macOS, Linux and Windows
ord: 5
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
    ref: packages/adapter-muse/src/harness/catalog.ts
  - kind: file
    ref: packages/adapter-muse/src/runner/home.ts
  - kind: file
    ref: packages/adapter-muse/src/runner/run.ts
---
The runner builds the thread's isolated Muse home by OS: it refuses any platform but three, links the macOS `Library/Keychains` only on darwin, and sets `USERPROFILE` only on win32. Callers pass `process.platform` in.

Read at ee24295b8e:
- `packages/adapter-muse/src/runner/home.ts:38` the three-name allow list; `:54` darwin keychain link; `:65` win32 `USERPROFILE`.
- `packages/adapter-muse/src/runner/run.ts:49,77` and `packages/adapter-muse/src/harness/catalog.ts:59` pass `process.platform`.

Done when the login material to link is declared by a per-OS provider composition supplies, the adapter names no OS, and its tests pass on a Linux runner.