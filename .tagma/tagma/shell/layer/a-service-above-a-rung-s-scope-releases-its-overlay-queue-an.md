---
id: 01a0c71d-51e8-72bd-b322-159d7f077d45
title: A service above a rung's scope releases its overlay, queue and scope-keyed cache for that rung in a `Handoff` hook
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
Nothing inside the teardown scope reaches them afterwards. `onLeave` fires before the rung's next scope opens; `onClosed` after the departed scope's keys are freed.