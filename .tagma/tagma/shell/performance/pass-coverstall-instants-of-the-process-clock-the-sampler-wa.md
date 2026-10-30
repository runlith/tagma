---
id: 01a0c84e-184c-70f8-a597-40d56e6841ec
title: Pass `coverStall` instants of the process clock the sampler was built with
ord: 20
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: symbol
    ref: packages/performance/src/TraceSampler.ts
    symbol: coverStall
---
A stall given in another clock's instants cannot be matched to the spans the sampler holds.