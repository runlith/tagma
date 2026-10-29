---
id: 01a13211-2c91-7268-9cf5-79d26d23a281
title: One calibration probe sets the upper bound through the maximum resource scale
ord: 25
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/budget.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/calibration.ts
---
One probe duration does not fix independent file and byte prices. Under non-negative linear cost, the sum of their contributions is known only on the sample; the upper bound for a growing subject is the sample duration times the larger of the file-count and byte scales. It covers any split of the measured cost between those resources. Both stored rates are projections of one duration: adding them charges it twice and can refuse a reachable judgment. Fixed reading costs stay in the sample and make the bound more conservative; it bounds the input, not wall time for arbitrary source.
