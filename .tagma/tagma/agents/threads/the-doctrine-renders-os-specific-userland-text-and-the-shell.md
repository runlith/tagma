---
id: 01a1a76d-60e1-7b99-8659-a90ad26bc0f0
title: The doctrine renders OS-specific userland text and the shell default from process.platform
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
    ref: apps/tagma/server/src/threads/doctrine/render.ts
---
The prompt renderer falls back to the server's own platform and writes macOS-specific userland advice into every agent's instructions.

Read at ee24295b8e:
- `threads/doctrine/render.ts:27` `userland` answers 'BSD userland; sed, stat and date differ from GNU' for darwin; `:42` the platform defaults to `process.platform`; `:49` the shell defaults to `cmd.exe` on win32.

Done when the world's facts (platform description, userland, shell) arrive complete from the world contract and the renderer holds no OS name.