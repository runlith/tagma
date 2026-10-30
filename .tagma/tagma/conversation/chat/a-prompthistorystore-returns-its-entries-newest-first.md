---
id: 01a0ca81-10ae-722e-a437-a164d9c37478
title: A PromptHistoryStore returns its entries newest first
ord: 27
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/chat-ui/src/PromptHistory.ts
    symbol: PromptHistoryStore
  - kind: symbol
    ref: packages/chat-ui/src/PromptHistory.ts
    symbol: record
---
`record` prepends a new entry and cuts the tail, and `previous` walks forward from index 0. A store that read oldest first would make the first recall return the oldest prompt.