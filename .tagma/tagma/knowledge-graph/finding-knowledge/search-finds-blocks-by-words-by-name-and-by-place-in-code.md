---
id: 01a14bc5-0df5-77c8-b1a2-693555927d12
title: Search finds blocks by words, by name, and by place in code
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69369c55efea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6949e55dee89
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/SelectionRepo.ts
    symbol: SelectionRepo
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/reads.ts
    symbol: READ_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/search/ranking.ts
    symbol: rankingLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/search/words.ts
    symbol: searchTerms
---
**Value.** The needed block is found by words, by name, or by its place in code, and search never returns retired knowledge unless asked.

**How.** `search_blocks`; in the app — the Knowledge column search field and block mention in a thread composer.

**Behaviour.**
- Every query word must match, but not necessarily as a phrase. Title matches rank above body and path matches; within a tier fresher ranks above older.
- Cyrillic matches by word form, other scripts by substring. Short terms drop, and an empty query returns the freshest blocks.
- A hex query finds a block by id, including replaced and finished ones.
- Finished work and replaced blocks stay hidden until history is asked for. A path filter keeps blocks with a source on that place.
- The answer arrives in pages with the total match count.

**Limits.** No transliteration. A cursor continues only the same query.
