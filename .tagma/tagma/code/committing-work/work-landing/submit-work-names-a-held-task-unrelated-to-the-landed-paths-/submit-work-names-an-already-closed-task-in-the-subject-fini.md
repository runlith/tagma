---
id: 01a1798c-36bf-759a-9de6-be9c82792793
title: submit_work names an already-closed task in the subject, finished by finish_block before this commit
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "Commit fe1b896e4b came out with the subject “… (349f6c92, 436d2baf, 4a5cdf9d)”, although 349f6c92 was already done via commit 58bb2a1812 and contributed nothing to fe1b896e4b",
    "command": "finish_block 349f6c92 (commit 58bb2a1812), then submit_work {paths: [apps/tagma/server/tsconfig.json, apps/tagma/server/package.json, apps/tagma/server/scripts, packages/testbed/src/watch.itest.ts]}",
    "expected": "The subject names 436d2baf and 4a5cdf9d — the tasks whose work the commit carries"
  }
---
In the same session before it, “(349f6c92, 436d2baf, 4a5cdf9d)” also arrived on 58bb2a1812, where only 349f6c92's work lay (recorded separately as da418206 — a repeat of this record).
