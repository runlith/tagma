---
id: 01a1516c-e34f-72c8-9a7c-33f8576cd754
title: A completed run pins the handled requests before the report is published
ord: 6
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent/src/collaboration/reporting.ts
    symbol: reportOwed
  - kind: symbol
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
    symbol: makeRunClosing
---
A completed run pins the handled requests before the report is published.

A new run can open right after the end is recorded, before the reporting stages. So handled requests are confirmed with the end and stored in its entry: the next run does not inherit them, and a deferred report reads the stored set. Confirming handling leaves the final-answer obligation open.
