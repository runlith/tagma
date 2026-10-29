---
id: 01a1166f-7227-76cc-abae-46f05b4a6709
title: Whether to keep a Holdings snapshot or verdict memo so a cold start after restart never walks every held path again
ord: 8
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Holdings derives from the record, git, and disk, and by spec lives in memory, with the folding in the process LRU. Question: is a durable memo table of verdicts and folding states needed, indexed on the full path-input fingerprint, so a cold start after a restart never walks every held path again. It is pure memory, never a second source of truth.

The S7-fixture measurement after building decides:
- when the visible threads' first frame or the cold-build wall misses budget — the table is needed;
- when they fit — it is not: the table would have to be kept consistent, and that is one more thing.
