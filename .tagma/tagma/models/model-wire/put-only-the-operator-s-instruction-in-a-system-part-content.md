---
id: 01a0c84d-3632-70cd-9b21-1731a840dbf3
title: Put only the operator's instruction in a system part; content received from tools or the web goes in user or tool messages
ord: 20
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/llm/src/llm/schema/messages.ts
    symbol: LLMRequest
  - kind: symbol
    ref: packages/llm/src/llm/schema/messages.ts
    symbol: Message
---
Untrusted content never lands in a system part, neither in the initial prompt nor in a request update; the caller ensures this.