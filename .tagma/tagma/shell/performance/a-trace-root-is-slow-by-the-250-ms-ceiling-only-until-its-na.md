---
id: 01a1366b-3157-7c95-9942-2ad18c848b58
title: A trace root is slow by the 250 ms ceiling only until its name's hundredth completion, then only above that name's p99
ord: 26
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/performance/src/PerformanceTracer.ts
    symbol: make
---
While a name has fewer than a hundred completions, its p99 says nothing, and the 250 ms ceiling tells a slow answer apart. Afterwards only that name's own distribution decides. An absolute ceiling forever kept every trace of a root always longer than 250 ms: background `CheckoutStatus.reading`/`.comparison` produced a third of all spans recorded in an hour (152k of 462k, 2026-10-13). Such a root now keeps its outliers and a hash share.

Unit (ceiling infinite) is never slow for its first hundred completions, as before.
