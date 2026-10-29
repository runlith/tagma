---
id: 01a0ca8a-3d5c-75e6-b335-96fac5a655ba
title: Resolve the labels pill from its own digit producer
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
Resolve the labels pill from its own digit producer.

Name source.provider and source.model; a fallback is allowed only for a missing source value.
