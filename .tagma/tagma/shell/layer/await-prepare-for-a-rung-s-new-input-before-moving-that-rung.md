---
id: 01a0c71d-51f3-79a9-b63b-28ac47906852
title: Await `Prepare` for a rung's new input before moving that rung's source
ord: 31
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
    symbol: prepare
  - kind: symbol
    ref: packages/layer/src/Prepare.ts
    symbol: Prepare
---
The scope opens with the chunks that have already landed, so an unawaited prefetch leaves it opening incomplete.