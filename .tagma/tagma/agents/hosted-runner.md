---
id: 01a18e33-3513-785d-9824-df6d3c2426a1
title: Hosted runner
ord: 103
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/agent.ts"
      },
      {
        "at": "src/cycle.ts"
      },
      {
        "at": "src/door.ts"
      },
      {
        "at": "src/handed.ts"
      },
      {
        "at": "src/history.ts"
      },
      {
        "at": "src/output.ts"
      },
      {
        "at": "src/relay.ts"
      },
      {
        "at": "src/run.ts"
      },
      {
        "at": "src/wire/"
      }
    ],
    "id": "@runlith/hosted-runner",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a108bd-5060-7141-819c-dd4dad88de8a
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/hosted-runner
---
A vendor SDK that Tagma drives as a thread's ACP agent runs in a runner process of its own, and this kit is that runner's side: the ACP session, turn opening, the tool relay and client output a vendor cycle plugs into through a neutral port, the door port through which the runner asks the server for the hosted prompt, tools and history, and the driver-runner wire both sides speak. It stays private to Tagma and its builtin packages, so the hosted protocol never becomes a public API; the server fills the door, and each builtin package brings its vendor cycle.