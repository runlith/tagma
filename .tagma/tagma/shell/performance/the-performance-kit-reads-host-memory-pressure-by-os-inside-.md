---
id: 01a1a76d-602b-7837-8b0c-fd919a3e902a
title: The performance kit reads host memory pressure by OS inside shared code
ord: 50
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
    ref: packages/performance/src/hostPressure.ts
---
`readHostPressure` runs the macOS `sysctl kern.memorystatus_vm_pressure_level` on darwin and reads the Linux `/proc/pressure/memory` on linux; elsewhere it answers `absent`. Both readers and their decoders sit in one shared file.

Read at ee24295b8e:
- `packages/performance/src/hostPressure.ts:7,12` `/usr/sbin/sysctl` on darwin; `:13,17` `/proc/pressure/memory` on linux.

Done when the module declares a pressure-reader contract, each OS reader is an adapter composition fills, and the Linux runner exercises the Linux reader and the decoders without the macOS one.