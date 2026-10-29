---
id: 01a0c84d-3632-70cd-9b21-1731a840dbf3
title: System carries only the operator's instruction; everything received goes through user or tool channels
ord: 20
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/llm/src/llm/schema
  - kind: dir
    ref: packages/llm/src/llm/utils
  - kind: symbol
    ref: packages/llm/src/llm/schema/messages.ts
    symbol: LLMRequest
  - kind: symbol
    ref: packages/llm/src/llm/schema/messages.ts
    symbol: Message
---
Untrusted content, including tool and web responses, never lands in a system part, neither in the initial prompt nor in a request update; the caller ensures this.
