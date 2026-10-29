---
id: 01a12792-64d6-7374-bc46-a942ec75f4da
title: Holder port
ord: 39
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "Holder.ts",
        "role": "port"
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "holder-port"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/execution-host/src/holder
---
The host logic and execution holders change independently, and the holder adapter depends on what the logic requires of it, so the requirement lives in a separate lower module: the `Holder` port with its records, refusals and the unit used for a process's birth time. The holder adapter fills it, the host logic reads it, and the host composition wires them.
