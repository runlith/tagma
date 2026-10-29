---
id: 01a0c71d-51e8-72bd-b322-159d7f077d45
title: The app-tier owner releases what it holds for the rung's scope at handoff, because nothing inside the teardown scope will reach it afterwards
ord: 30
tags: ["rule"]
sources:
  - kind: file
    ref: packages/layer/src/App.ts
  - kind: file
    ref: packages/layer/src/Failure.ts
  - kind: file
    ref: packages/layer/src/Handoff.ts
  - kind: file
    ref: packages/layer/src/Prepare.ts
  - kind: symbol
    ref: packages/layer/src/App.ts
    symbol: leaving
  - kind: symbol
    ref: packages/layer/src/Handoff.ts
    symbol: Handoff
---
Overlay, queue and scope-keyed cache belong to the service above the scope. `leave` comes before the rung's next scope opens; `closed` — after the departed scope's keys are freed.
