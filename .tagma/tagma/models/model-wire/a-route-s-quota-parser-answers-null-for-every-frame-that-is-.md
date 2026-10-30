---
id: 01a0c863-dce1-72e3-ba81-2456617c8f89
title: A route's quota parser answers null for every frame that is not a quota frame of its own provider
ord: 23
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/llm/src/llm/route/definition.ts
    symbol: FrameQuotaParser
  - kind: symbol
    ref: packages/llm/src/llm/route/definition.ts
    symbol: makeFromTransport
---
The route calls the parser on every transport frame and accepts every non-null answer as the account's quota; the return type cannot tell a foreign frame from its own.