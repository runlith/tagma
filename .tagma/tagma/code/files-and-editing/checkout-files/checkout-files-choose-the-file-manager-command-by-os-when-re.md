---
id: 01a1a76d-6080-76ad-9f8a-c9a3053707f1
title: Checkout files choose the file-manager command by OS when revealing a path
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
    ref: apps/tagma/server/src/checkout-files/reveal/files.ts
---
Revealing a path builds `open -R` on darwin, `explorer.exe /select,` on win32 and `xdg-open` elsewhere, with a per-OS rule for whether the exit code counts. The search content module passes `process.platform` to ripgrep (its own task).

Read at ee24295b8e:
- `checkout-files/reveal/files.ts:15-17` the three commands in `commandFor`; `:34` the platform defaults to `process.platform`.

Done when reveal asks an opener port, each file manager is an adapter composition supplies, and the module's tests pass on a Linux runner.