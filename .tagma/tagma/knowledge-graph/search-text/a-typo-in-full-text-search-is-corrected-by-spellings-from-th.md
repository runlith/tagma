---
id: 01a1736d-1663-7d11-9c8e-49dfad8cb6ee
title: A typo in full-text search is corrected by spellings from the index's bounded fresh sample, then the strict query repeats with them
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1734b-d7e6-7660-80b4-37dff267eadb
sources:
  - kind: symbol
    ref: packages/search-text/src/fts.ts
    symbol: nearQuery
  - kind: symbol
    ref: packages/search-text/src/fts.ts
    symbol: spellingsOf
---
The FTS5 trigram index knows no words, so a spelling near the typo is found in two steps. First the rows holding at least one trigram of the query word, or of its neighbor-transposed variant, are read. Only the freshest of them are read, within `SPELLING_SAMPLE`, and in those texts `spellingsOf` picks spellings within the allowed OSA distance, nearest and most frequent first. An exact word match in one row therefore doesn't push out a near spelling standing next to other query words in another. The spelling plan rides the cursor, so continuing the page reads the same selection. Then the index owner repeats its usual strict query, with each forgiven word replaced by an OR group of those spellings. Ranking, pages, cursors and `total` of the approximate results are the same as the strict one's, and it's found across all history, not just the sample.

The rejected option was to pick candidate documents by trigrams and check the distance straight in their text. The OR expression matches most rows. Ranking candidates by bm25 lets long bodies push out the real matches. Checking whole texts makes event-loop work grow with body size. On the runlith graph that cost 200–700 ms of JS per query, and half the needed blocks were still lost.

The sample is bounded by construction, so loop parsing costs a few milliseconds on any corpus. The sample SQL walks the index by `rowid desc` and stops at the limit. Its cost only grows with the matches the area filter drops before the limit, like the strict query's. The price of this: a word seen only in old history and missing from the fresh sample isn't corrected, and the answer stays empty. The sample is taken past the area filters, so other projects and the reader's own thread don't occupy it.

Trigrams also set the coverage limit. A neighbor transposition is found at any word length. Any single edit is found from 6 letters, two edits from 9. A middle replacement, drop or insertion in a 4–5 letter word breaks every shared trigram (`form`/`firm`, `plnt`/`plant`). Sometimes the same happens with two edits in an 8-letter word. Such a typo isn't found. FTS5 trigram doesn't answer two-letter queries, and alphabet enumeration in the expression cost 150–300 ms of SQL and turned the sample random. Only a dedicated index word dictionary would give full coverage. A three-letter spelling and a word with non-letter marks (a path, a dotted identifier) don't count as typos: a strict three-letter substring search would drown in matches.
