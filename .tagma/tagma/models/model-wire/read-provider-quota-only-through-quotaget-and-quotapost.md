---
id: 01a0c85c-247b-7bc8-bd85-fd4667c35396
title: Read provider quota only through `quotaGet` and `quotaPost`
ord: 22
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/llm/src/profiles/quotaRead.ts
    symbol: withQuotaWire
---
They apply `withQuotaWire`, which picks the HTTP client: the package writer, or the `QuotaDoor` a caller provides. A hand-built request skips that choice.