---
id: 01a10326-9d9d-7ddf-8111-37bc50467575
title: Search text
ord: 45
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/words.ts"
      },
      {
        "at": "src/stem.ts"
      },
      {
        "at": "src/trigram.ts"
      },
      {
        "at": "src/highlight.ts"
      },
      {
        "at": "src/fts.ts"
      },
      {
        "at": "src/match.ts"
      }
    ],
    "id": "@runlith/search-text",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/search-text
---
The graph and threads use the same text parsing for search, and the kit provides it: normalization, words (including cutting spaceless scripts), the word stem — Russian for Cyrillic, English Snowball for Latin, the rest as-is — and the word form for the trigram index. With the same parsing it finds the found words in the text and cuts a fragment around them, so results and screen highlight the same. For the FTS5 trigram index the kit also gives the shared form: the text-to-index projection, query parsing into words of at least three letters and shorter ones, the MATCH expression, the `rowid` time key, and the fallback query over near word spellings when the strict one is empty — so thread-conversation search and call search parse text and query the same. Tables, traversal and counting are the index owner's call; the kit has no dependencies. The kit's second half is matching the typed query against names (`./match`): list ranking that tolerates omissions and typos, and the positions of matched letters — one for every app list, the composer menu and Quick Open files.
