---
id: 01a0c70f-8464-79d0-a112-840adf0b0afd
title: The graph snapshot travels in the `__layer` field of a route's load data
ord: 26
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/layer/src/Snapshot.ts
    symbol: of
  - kind: symbol
    ref: packages/layer/src/Snapshot.ts
    symbol: SNAPSHOT_FIELD
---
`Snapshot.of` reads only that field, so a load's own data must not use the name `__layer`.