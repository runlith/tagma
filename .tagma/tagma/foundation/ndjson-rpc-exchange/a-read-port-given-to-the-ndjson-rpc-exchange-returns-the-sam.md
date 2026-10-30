---
id: 01a0c6ef-8095-71dc-b7bd-f6fdd1fb5eee
title: A read port given to the ndjson-rpc exchange returns the same bytes for the same offset
ord: 4
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/ndjson-rpc
  - kind: symbol
    ref: packages/ndjson-rpc/src/exchange.ts
    symbol: consume
  - kind: symbol
    ref: packages/ndjson-rpc/src/exchange.ts
    symbol: ExchangePorts
---
The exchange tracks its place by offset and resumes from it; a port that answers an offset differently desynchronizes it.