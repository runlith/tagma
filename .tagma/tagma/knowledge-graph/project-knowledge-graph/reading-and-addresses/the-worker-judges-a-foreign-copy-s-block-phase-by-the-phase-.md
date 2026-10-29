---
id: 01a159e6-fad2-7b47-aae4-bd81f92d868b
title: The worker judges a foreign copy's block phase by the phase words published in its `meta`, and distrusts a publication whose revision lags the dictionary revision
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/copyIndex.worker.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/phaseWords.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/typeProjection.ts
---
The reader never loads another graph's dictionary: a copy itself publishes `phase-words:<project>` — the `wordsAt` of every phase under every contract of its `TagTable`, together with the dictionary revision. That is the same function by which its own graph judges `contractAt`, so another's "finished" means the same as one's own. The publication is written by `projectTypeIds` in the same act where the dictionary revision grows, and by `completeDerived` on copy open where it is missing or stale. A per-block phase column was rejected: a tag-word change would require recomputing all its carriers, while a publication changes in one row. A phase on a mismatched revision is unknown, and the pool opens such a copy once so the publication stands.
