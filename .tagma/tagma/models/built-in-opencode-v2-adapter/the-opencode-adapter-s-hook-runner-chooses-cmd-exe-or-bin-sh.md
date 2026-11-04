---
id: 01a1a76d-6024-780b-89c5-3269e3c83df6
title: The OpenCode adapter's hook runner chooses cmd.exe or /bin/sh by OS
ord: 9
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
    ref: packages/adapter-opencode/src/harness/plugin.ts
---
The plugin runs a configured hook command through the platform shell and branches on `win32` to build the argv.

Read at ee24295b8e:
- `packages/adapter-opencode/src/harness/plugin.ts:47` `ComSpec /d /s /c` on win32, `/bin/sh -c` elsewhere.

Done when the shell invocation comes from the same shell contract as the workspace tools' world and the adapter names no OS.