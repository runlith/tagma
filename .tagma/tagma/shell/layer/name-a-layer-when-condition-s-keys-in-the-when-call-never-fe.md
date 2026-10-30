---
id: 01a0c70d-70e2-72e0-9c3a-c424bce7656c
title: Name a `Layer.when` condition's keys in the `when` call; never fetch other keys inside the predicate
ord: 24
tags: ["rule"]
sources:
  - kind: file
    ref: packages/layer/src/Layer.ts
  - kind: symbol
    ref: packages/layer/src/Layer.ts
    symbol: tiersOf
  - kind: symbol
    ref: packages/layer/src/Layer.ts
    symbol: when
---
The predicate receives the values of the keys declared on the layer, and the layer's tiers come from those keys.