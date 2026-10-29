---
id: 01a12893-cecf-7798-9b3d-e2ed4a42e855
title: Holder client
ord: 42
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "Connection.ts",
        "for": [
          "921755ee",
          "d2a60527"
        ]
      },
      {
        "at": "Link.ts",
        "for": [
          "921755ee"
        ]
      }
    ],
    "id": "holder-client"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a12792-64d6-7374-bc46-a942ec75f4da
sources:
  - kind: dir
    ref: packages/execution-host/src/holder-client
---
The host logic speaks to the holder in one frame protocol on any OS, so the frame codec and the connection that asks over it, answers and assembles the `Holder`-port executions are taken out of the adapters into their own module. It declares `Link` — the channel to the holder, handle intake, their IO, run state and launch preparation — which the platform adapter fills in; it takes capabilities, the handle limit and run exits from the holder's frames and knows no OS itself.
