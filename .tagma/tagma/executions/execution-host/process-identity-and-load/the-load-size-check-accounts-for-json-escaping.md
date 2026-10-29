---
id: 01a14de6-8c62-71f7-94db-13506d1d4c6c
title: The Load size check accounts for JSON escaping
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
sources:
  - kind: symbol
    ref: packages/execution-host/src/ProcessUsage.ts
    symbol: bounded
---
Command text, names and diagnostic strings can hold control characters: their JSON escape outruns the source UTF-8, so a pre-serialization field estimate never proves the frame size. The Load owner first serializes the full answer; a cheap upper bound on the finished JSON length is safe, and at the envelope boundary counts it as UTF-8. Dropping command text and process lines keeps group CPU and memory totals, otherwise the delivery cap would skew the machine measurement.
