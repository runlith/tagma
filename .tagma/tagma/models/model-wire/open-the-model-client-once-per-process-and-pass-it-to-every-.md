---
id: 01a0c891-0cd0-79bd-8b9d-6a232d2e2841
title: Open the model client once per process and pass it to every model call
ord: 30
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/llm/src/models/client.ts
    symbol: openModelClient
---
Never open one with `openModelClient` for a single call.