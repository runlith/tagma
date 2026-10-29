---
id: 01a14c05-9e90-75d0-ab7c-581071b77aa7
title: The user records a problem reproduction and stops recording with the report
ord: 6
tags: ["feature"]
fields:
  {
    "state": "promised"
  }
edges:
  - kind: relates
    to: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b1df27ae3e
  - kind: relates
    to: 01a14c05-9e90-75d0-ab7c-580f84a0bdd4
sources:
  - kind: file
    ref: apps/tagma/desktop/src/report.ts
  - kind: file
    ref: apps/tagma/server/src/performance/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/performance/layer.ts
---
**Value.** The user must reproduce a problem with detailed recording on, without changing standing settings or collecting profiles by hand.

**How.** In the accepted self-observation spec, Start recording and Stop and report stand next to sending the report.

**Behaviour.** The goal is to temporarily switch spans and the CPU profile on for the chosen window, then automatically stop recording and keep the report of exactly this reproduction.

**Limits.** State: promised — the checked code has no user state, operation, driver or UI of such a mode. A manual CPU capture is already reachable but does not switch on this whole scenario. The separate channel-defaults key and enable switch the promise is built on are missing too.
