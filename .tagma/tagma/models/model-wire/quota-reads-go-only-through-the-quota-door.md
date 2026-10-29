---
id: 01a0c85c-247b-7bc8-bd85-fd4667c35396
title: Quota reads go only through the quota door
ord: 22
tags: ["rule"]
sources:
  - kind: file
    ref: packages/llm/src/llm/schema/quota.ts
  - kind: file
    ref: packages/llm/src/profiles/quotaRead.ts
  - kind: symbol
    ref: packages/llm/src/profiles/quotaRead.ts
    symbol: withQuotaWire
---
Wire selects withQuotaWire: by default the package writer, otherwise the client named by the caller; bypassing this choice bypasses the stub, the replay, and the egress guard.
