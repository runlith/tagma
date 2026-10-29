---
id: 01a1321d-a7cb-718c-b7da-9ee151e5e023
title: A refusal on a stored calibration needs a fresh bounded sample
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/calibration.ts
  - kind: symbol
    ref: apps/tagma/inspection/src/core/node/budget.ts
    symbol: probeOf
---
A stored calibration is an observation of a small sample, not proof of a new reach's cost: the source count and size could have changed its representativeness. When the disk-read estimate exceeds a known subject's budget, the worker takes a fresh bounded sample before a new refusal; the cap itself stays. The sample spreads over the set so a small alphabetical prefix doesn't turn the fixed costs of reading and a cold parser into the price of every byte of a large project; a small change stays the first selection set.
