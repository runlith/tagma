---
id: 01a1031e-d5ce-7656-be01-1b1ac473dc07
title: Move text parsing for search into the `@runlith/search-text` kit and move the graph onto it
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1031f-50dc-7ab4-83d5-63971e875aa6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a101d9-1575-7f74-94e1-12734860ce23
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/search/words.ts
  - kind: file
    ref: packages/search-text/src/russian.ts
---
Builds [[4860ce23]] whole: the kit with words, normalization, English and Russian stems, and the trigram form; its #module card via `set_module`; the graph's move and its projection rebuild via `completeDerived`.

Start with `apps/tagma/server/src/graph/search/stem.ts` and `words.ts`.

Done when the spec's acceptance is met and the existing graph-search integration tests pass.
