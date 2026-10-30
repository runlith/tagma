---
id: 01a0c88b-43f4-7c67-9fb2-d273a09403b7
title: "Production code opens the model client without a door: `doorOf` is a test seam"
ord: 29
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/llm/src/llm/route/transport
  - kind: symbol
    ref: packages/llm/src/llm/route/transport/doorOf.ts
    symbol: doorOf
---
`doorOf` wraps a stub `fetch` and disables tracer propagation, so a client built on it differs from the real wire.