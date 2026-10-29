---
id: 01a0cabc-7764-778a-90dd-0a93fb659192
title: A workflow run abandoned by a dead driver is never re-driven, and the abandonment is stated nowhere
ord: 35
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/workflows/library.ts
    symbol: workflows
---
`start` drives each run detached on this process with no pass behind it: `advanceWorkflow`'s only caller in the checkout is the forked `drive`, the faces expose list, start and runsOf with no resume door, and nothing adopts an expired lease. Once the driving process dies, the run sits where the records say it stopped, for good. The `next pass picks the run up` promise that used to deny this was stripped in c6f42a3059 — but the abandonment is still stated nowhere, so the run's fate after a dead driver is neither driven nor documented.

Done when a driver adopts expired-lease runs (a pass, a resume door, or adoption at boot) — or the run's abandonment is stated as the behavior in the graph.