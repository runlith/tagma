---
id: 01a0c891-0cd0-79bd-8b9d-6a232d2e2841
title: One model client per process
ord: 30
tags: ["rule"]
sources:
  - kind: file
    ref: packages/llm/package.json
  - kind: file
    ref: packages/llm/src/llm/call.ts
  - kind: file
    ref: packages/llm/src/models/client.ts
  - kind: symbol
    ref: packages/llm/src/llm/route/transport/verbatim.ts
    symbol: layer
  - kind: symbol
    ref: packages/llm/src/models/client.ts
    symbol: openModelClient
---
The client is passed into every call, never rebuilt for just one.
