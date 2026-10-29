---
id: 01a0c71d-51f3-79a9-b63b-28ac47906852
title: A caller moving a rung's source first awaits that rung's prefetch, because the scope opens with the chunks that have already landed
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
