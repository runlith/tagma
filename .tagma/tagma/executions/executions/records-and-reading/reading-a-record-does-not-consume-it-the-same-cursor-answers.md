---
id: 01a0c712-6e02-709e-9845-36cc59db7fbb
title: "Reading a record does not consume it: the same cursor answers with the same bytes, and another reader's position is untouched"
ord: 5
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/Executions.ts
  - kind: symbol
    ref: packages/executions/src/ExecutionRecord.ts
    symbol: read
---
