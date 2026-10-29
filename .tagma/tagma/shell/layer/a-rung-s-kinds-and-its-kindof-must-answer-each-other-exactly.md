---
id: 01a0c70d-9a85-7326-b249-f2e4ae398c1f
title: "A rung's kinds and its `kindOf` must answer each other exactly: every listed kind is one some input yields, and every yielded kind is listed"
ord: 25
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/layer/src/Rung.ts
  - kind: symbol
    ref: packages/layer/src/Rung.ts
    symbol: kindOf
  - kind: symbol
    ref: packages/layer/src/Rung.ts
    symbol: kinds
---
