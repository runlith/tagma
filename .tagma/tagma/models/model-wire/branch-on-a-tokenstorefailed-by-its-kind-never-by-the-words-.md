---
id: 01a0c877-40eb-7dd6-ab5f-c1d4cf34531b
title: Branch on a `TokenStoreFailed` by its `kind`, never by the words of `reason`
ord: 26
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: symbol
    ref: packages/llm/src/oauth/storeFailure.ts
    symbol: TokenStoreFailed
---
The wording of `reason` is for people and may change.