---
id: 01a13644-6c41-7ac3-a5a7-96757fa54394
title: The store counts and returns the base's freed pages in portions with its own fiber; the deleter only wraps the deletion in Store.freeing
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13639-5ab7-793d-a23b-1cf699798b81
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/vacuum.ts
---
`PRAGMA incremental_vacuum` holds the base's single writer for the whole instruction, and one page's cost grows with freelist size. On a base with millions of free pages one N-page instruction held the writer for tens of seconds, with thread journals, state publications and thread opening queued behind it.

So the deleter wraps the deletion in `Store.freeing(work)` and does not wait on the return. How many pages the work freed is counted by the store: the freelist plus its own already-returned pages before and after the work, both under the writer. A caller-side delta of one freelist is not counted: the background return shrinks the same freelist in parallel, and the delta loses freed pages.

The store returns pages with its own fiber:
- each portion is a separate transaction; a new instruction starts only while less than a portion has passed since the portion's start;
- between portions a pause no shorter than the portion's holding, COMMIT counted;
- the step in pages starts at one per pass and grows no more than double after a fast instruction, so one instruction cannot inherit a step learned on a cheap freelist;
- the debt clamps to the freelist inside the portion and zeroes when the base is not in incremental mode.

The portion commit is weakened. Debt lost at a server stop or crash is pages left in the freelist; later writes reuse them, and nothing is lost. A deleter that calls `incremental_vacuum` itself — inside a thread's domain lane least of all — brings back the old halt of every writer.
