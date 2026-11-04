---
id: 01a1a76d-5ff3-7e82-acdf-8399cb0a4161
title: The workspace tools pick shell, spawner and glob semantics by win32
ord: 162
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
    ref: packages/agent-tools/src/world/machine.ts
  - kind: file
    ref: packages/agent-tools/src/removal/patterns.ts
  - kind: file
    ref: packages/agent-tools/src/removal/selection.ts
---
The machine world of the tools chooses the shell program and the child-process spawner by OS, and the removal tool reads the platform fact out of the world to switch path and glob semantics. The world carries `platform` as a fact, so the tools learn the OS and branch on it themselves.

Read at ee24295b8e:
- `packages/agent-tools/src/world/machine.ts:15` `cmd.exe` on win32, `/bin/sh` elsewhere; `:19-20` the Bun child-process layer on win32, `bunSpawner()` elsewhere; `:40` `platform: process.platform`.
- `packages/agent-tools/src/removal/selection.ts:78` passes `platform === 'win32'` into pattern expansion; `packages/agent-tools/src/removal/patterns.ts:62,77,92` switch separators, trailing-slash rules and the matcher's `platform: 'win32' | 'linux'`.

The same win32 shell or spawner choice repeats in `apps/tagma/server/src/enforcement/workers/inspecting.ts`, `threads/doctrine/render.ts`, `native-harness/agents/library.ts` and `packages/adapter-opencode/src/harness/plugin.ts`; each stands in its own module's task.

Done when the world declares its shell, spawner and path semantics as a contract filled per OS by composition, the tools read that contract and never an OS name, and the module's tests pass on a Linux runner.