---
id: 01a1a76d-60bd-71ed-ac6d-2a0020bc9568
title: Checkout speed-up decides which Git fsmonitor platforms exist
ord: 32
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
    ref: apps/tagma/server/src/workspace/checkouts/fastStatus.ts
---
The fast-status setting enables Git's fsmonitor daemon only where the module's own list of operating systems says Git ships one.

Read at ee24295b8e:
- `workspace/checkouts/fastStatus.ts:31` `MONITORED` is the set `darwin`, `win32`; `:116` `process.platform` is passed to `monitorCarried`.

Done when the module asks Git whether its daemon is built in (the `fsmonitor--daemon` build feature already read at `:40`) and drops the OS list.