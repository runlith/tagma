---
id: 01a0c88b-43f4-7c67-9fb2-d273a09403b7
title: A model client takes the package writer, not a door from doorOf
ord: 29
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/llm/src/llm/route/transport
  - kind: symbol
    ref: packages/llm/src/llm/route/transport/doorOf.ts
    symbol: doorOf
---
doorOf is a test seam with stub fetch and disabled tracer propagation; its head assembles fetch, not route.
