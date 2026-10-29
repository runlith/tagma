---
id: 01a1737f-bd30-7989-a528-92b396b8564b
title: A full-text index word dictionary, to catch typos in short words too
ord: 4
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1734b-d7e6-7660-80b4-37dff267eadb
---
The fallback search over blocks, threads and calls looks for near spellings by trigrams. It doesn't find an inner edit in a 4–5 letter word (`plnt` → `plant`, `form` → `firm`): such spellings share no trigram, and FTS5 trigram gives no two-letter prefix queries. Enumerating the alphabet in the expression cost 150–300 ms of SQL and made the selection random. There is a second limit: a word seen only in old history outside the fresh sample isn't corrected.

A dedicated word dictionary of the index removes both limits: the word and its frequency, written with the index, and distance search straight in the dictionary. The cost is new tables at the index owners (graph, threads, calls), writes at indexing time, and a driver catching up what's already accumulated. Worth deciding on by complaints about short words: the open question is how often a typo in a 4–5 letter word shows up in full-text search versus name search, where it's already forgiven.
