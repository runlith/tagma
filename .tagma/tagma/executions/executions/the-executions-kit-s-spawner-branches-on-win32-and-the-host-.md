---
id: 01a1a76d-5fdb-7478-9e3d-c05a8019925f
title: The executions kit's spawner branches on win32 and the host protocol closes the set of operating systems
ord: 90
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
    ref: packages/executions/src/bunSpawner.ts
  - kind: file
    ref: packages/executions/src/protocol/capacity.ts
---
The kit's process spawner decides from `process.platform` whether a detached child leads its own process group, so the shared spawner carries Windows behaviour next to the POSIX one.

Read at ee24295b8e:
- `packages/executions/src/bunSpawner.ts:134` `leads` is false on `win32`.

Unclear:
- `packages/executions/src/protocol/capacity.ts:106` `HostPlatform.os` is the closed literal `darwin | linux | win32`. It is data an adapter declares, but a new operating system edits this shared contract; whether it should be an opaque name checked against the adapter's declaration is the owner's call.

Done when the spawner names no OS (the group-leader decision comes from the adapter that fills the spawn contract), the host protocol does not enumerate operating systems or the enumeration is the owner's accepted contract, and the module's OS-independent tests pass on a Linux runner.