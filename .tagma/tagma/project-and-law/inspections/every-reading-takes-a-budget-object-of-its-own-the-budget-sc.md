---
id: 01a1ada3-512c-7751-92a0-c4242198fe7d
title: "Every reading takes a budget object of its own: the budget scopes the modules pack's reader cache"
ord: 64
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/budget.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/probes.ts
---
A budget both meters a reading and marks its round: the modules pack keys the probes and resolvers it reuses within one judgement by the budget object, so the two sides and the move reads of one judgement share them while the next judgement starts clean. That is why no shared budget value exists — `unbounded()` and `budgetOf` hand out a fresh object on every call. A budget passed to two judgements joins them into one round: a tree read by both serves the first judgement's resolutions to the second, which after a reinstall of a package config judged the second side against the old aliases.