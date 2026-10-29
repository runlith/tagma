---
id: 01a0c877-40eb-7dd6-ab5f-c1d4cf34531b
title: Branch on store failure by tag and kind, not by the words of reason
ord: 26
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/llm/src/oauth/accountKey.ts
  - kind: file
    ref: packages/llm/src/oauth/credential.ts
  - kind: file
    ref: packages/llm/src/oauth/FileTokenStore.ts
  - kind: file
    ref: packages/llm/src/oauth/storeFailure.ts
  - kind: symbol
    ref: packages/llm/src/oauth/FileTokenStore.ts
    symbol: TokenStore
  - kind: symbol
    ref: packages/llm/src/oauth/storeFailure.ts
    symbol: TokenStoreFailed
---
