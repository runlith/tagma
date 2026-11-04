---
id: 01a1a76d-60e8-78e5-8852-65a7734052e3
title: The native harness fills the agent world's shell by win32 check
ord: 73
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
    ref: apps/tagma/server/src/native-harness/agents/library.ts
---
Composing an agent's context fills the world's `platform` and `shell` from `process.platform`, with `cmd.exe` on win32.

Read at ee24295b8e:
- `native-harness/agents/library.ts:287`.

Done when the world is taken from the same world contract the workspace tools and the doctrine read, and the harness names no OS.