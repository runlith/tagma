---
id: 01a101d9-1575-7f74-94e1-12734860ce23
title: "The `@runlith/search-text` kit parses text for search: English and Russian words, normalization, and stems"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/search/words.ts
  - kind: file
    ref: packages/search-text/src/russian.ts
---
Graph and threads search text with one parsing: words, normalization, and stems. English and Russian reduce to stems; any other language passes stemless, and the index owner finds it by substring.

Today parsing lives inside the graph (`graph/search/stem.ts`, `words.ts`) and stems only Cyrillic. Thread search needs the same parsing, so it moves to a kit below both consumers. It must not go into `@runlith/utils`: those are small primitives, not a subject.

## What the kit does

- **Words.** A letter with its combining marks (`\p{M}`) is part of the word. The graph's current regex (`graph/search/words.ts`) does not pass marks and tears "भारत" into "भ" and "रत". An identifier or path stays one word and is not stemmed. Joined writing (Chinese, Japanese, Thai) is cut by `Intl.Segmenter`: "黑山旅游怎么样" → 黑山 / 旅游 / 怎么 / 样.
- **Normalization.** Lowercase, Latin diacritics fold (`café` → `cafe`), `ё` → `е`. Marks that make another letter stay: `й` does not become `и`. `foldDiacritics` from `@runlith/utils` will not do — it cuts all `\p{Diacritic}`, breve included.
- The word's **stem** is picked by the word's script:
  - Cyrillic — the current Russian stemmer;
  - Latin — English Snowball;
  - other scripts — the word as is.
- The **trigram-index form.** Joined-writing symbols (Han, hiragana, katakana, hangul) double: "黑山" → "黑黑山山". Trigram needs 3 symbols, and a two-sign word after doubling gives 4. Substring search stays exact. Both consumers search with a trigram index, so the form lives here, not in two copies.

The kit yields text normalization, its words, the word stem, and the trigram form. How to build the index and query from this is the index owner's decision: the kit knows no SQLite and FTS5. The kit has no dependencies.

The #module card (kit, `packages/search-text`, no imports) is created via `set_module` by the same change that moves the code. `graph` and `threads` gain a relation to it.

## The graph moves

`graph/search/stem.ts` and word parsing from `words.ts` move to the kit. Assembling the graph projection (`searchProjectionOf`, `indexedWords`) and the `SEARCH_TERM_MIN` threshold stay with the graph: that is its index.

The graph index is a stem trigram (`drizzle/20260815013309_search_index_fts`). So the graph applies the kit's trigram form to its projection and to the query, and checks the `SEARCH_TERM_MIN` threshold after it: "黑山" after doubling is 4 symbols. Otherwise the "黑山旅游" query would lose all terms after cutting, and `ranking.ts` would return just fresh blocks. The rest of graph search semantics is unchanged. English stems change the blocks' stored projection, so it is rebuilt once via the existing `completeDerived` path: `search_index` rows are cleared and recomputed at startup.

## Acceptance

- "trips" finds "trip" and back, "Черногория" finds "Черногорию" — in graph and threads alike.
- Chinese text cuts into words. A Chinese query in the graph finds the block with these words, not a fresh-block listing.
- "भारत" stays one word.
- `ё` folds, `й` stays, `café` matches `cafe`.
- Graph search on Russian queries after the rebuild finds the same as before. The existing graph integration tests show this.
- Parsing is verified by the kit's unit tests on its output.
