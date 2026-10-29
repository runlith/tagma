---
id: 01a11323-2888-7706-a8fc-7240e4024638
title: The list_threads activeSince window does not gather the whole activity thread population into one array
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18896-d1d7-7a8f-9e41-11f033935b52",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1129a-5607-7dbf-8fe2-02073d2a8b42
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/active.ts
---
`threads/list/active.ts` reads `ActivityRecord.threads` page by page but piles every page into one array and Set. `threads/lifetime.ts` and `evidence/reading.ts:135–140` then pin the whole population. The cost of `list_threads activeSince` grows with the number of active threads, not with the page.

Do: carry a saved-selection handle through the thread-list boundary, or intersect with metadata filters at that boundary, without gathering the population on loop.

Done when a `list_threads activeSince` page holds no window thread set in memory; a test through the public read on a selection larger than one page. Source: finding 6 of the third activity architecture review.
