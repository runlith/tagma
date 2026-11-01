---
id: 01a19486-8e53-797a-b89f-84c93db57fb3
title: Holdings keeps exact summaries while compact verdict details share an evictable budget
ord: 15
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c144a8862f
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judges.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/details.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/packed.ts
---
A followed checkout must keep its path summaries and holder totals exact even after detailed line evidence leaves memory. Detailed verdicts therefore live separately in one byte-budgeted LRU shared by all checkout judges; its fractional-RAM allowance scales down on smaller machines and stops growing at the spec's reference profile rather than multiplying with checkouts or followers: line coordinates and region boundaries are columns, texts are pooled, and writer marks are interned. Packing runs in the walk worker and materializes overwritten-row relations, so retained evidence reaches no lazy fold history. A warm explicit judgement checks current inputs before exposing lazy readonly line and region arrays over that evidence; it does not repeat projection or expand every line. Eviction changes neither the summary nor its revision: a later explicit judgement folds only its requested missing paths again. Releasing a path or closing its judge drops its cached detail.