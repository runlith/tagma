---
id: 01a0c712-6e02-709e-9845-36cc59db7fbb
title: "Reading a record does not consume it: the same cursor returns the same bytes"
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/Executions.ts
  - kind: symbol
    ref: packages/executions/src/ExecutionRecord.ts
    symbol: read
---
The cursor belongs to the reader, so another reader's position is untouched and a retried read lands on the same bytes.