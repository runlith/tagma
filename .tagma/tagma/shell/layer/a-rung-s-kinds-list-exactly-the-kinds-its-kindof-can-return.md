---
id: 01a0c70d-9a85-7326-b249-f2e4ae398c1f
title: A rung's `kinds` list exactly the kinds its `kindOf` can return
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
Every listed kind is one some input yields, and every yielded kind is listed.