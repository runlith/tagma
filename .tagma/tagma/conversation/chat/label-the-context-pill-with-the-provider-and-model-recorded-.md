---
id: 01a0ca8a-3d5c-75e6-b335-96fac5a655ba
title: Label the context pill with the provider and model recorded in its reading (`source.provider`, `source.model`)
ord: 31
tags: ["rule"]
sources:
  - kind: file
    ref: packages/chat-ui/src/contextUsage.ts
  - kind: symbol
    ref: packages/chat-ui/src/contextUsage.ts
    symbol: ChatContextSource
  - kind: symbol
    ref: packages/chat-ui/src/contextUsage.ts
    symbol: chatContextUsageMetrics
---
Fall back to another name only when the source value itself is missing.