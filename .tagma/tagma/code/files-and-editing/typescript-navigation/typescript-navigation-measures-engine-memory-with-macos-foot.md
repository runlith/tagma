---
id: 01a1a76d-6031-7797-9c3f-d3f6ebaf98ce
title: TypeScript navigation measures engine memory with macOS footprint chosen by OS in the kit
ord: 13
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
    ref: packages/navigation-ts/src/memory.ts
---
The engine's memory is the process tree's `phys_footprint` from the macOS `footprint` tool when `process.platform` is darwin, and RSS from `ps` otherwise.

Read at ee24295b8e:
- `packages/navigation-ts/src/memory.ts:31` `Bun.which('footprint')` only on darwin.

Done when the memory reading is a contract with a per-OS adapter filled by composition and the kit names no OS.