---
id: 01a1500f-ddd5-7765-98f2-cb79a1b03b94
title: "`yield* X.optional()` in make answers with the conditional key at service build time: a later condition switch does not rebuild the reader"
ord: 38
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/layer/src/key.ts
    symbol: optionalOf
---
`optional()` is `find()`'s pair for `make`: a marker, not a key, so it is not part of the manifest requirements (`Requires`, `Layer.provide`), and a conditionless service can depend on a key the manifest gives only under `Layer.when`. The answer is the instance if the key stands in its tier's scope, else `undefined`; the graph, the load run and `Screen` answer it the same as `find()`.

Boundary: the answer is taken once, when the reader is built. If the condition switches later, the reader is not closed or rebuilt — it holds the taken instance or never sees the one that appeared. So `optional()` fits conditions constant for the reader's lifetime (host capabilities over `Host`, which composition sets once per window); a condition changing during the reader's life is read through `find()` at the use site. Rebuilding the reader on condition change is rejected: it is a dependency on the condition the graph keeps nowhere else, for a case the code has none of.
