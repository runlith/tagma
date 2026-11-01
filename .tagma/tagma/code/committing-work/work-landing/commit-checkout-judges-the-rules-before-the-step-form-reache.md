---
id: 01a1951a-a07d-7565-998f-9b3c606f6aab
title: commit_checkout judges the rules before the step form reaches the working files
ord: 180
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1950b-c9c4-7c8f-9197-a93c00c9778c",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1950b-9c81-75b2-8c92-eca2c3902800
---
`commitIndex` (`landing/land/indexCommit.ts`) calls `ask.judge` on the tree the commit steps built, and `checkouts.ts` carries the steps' delta into the working files only after it, so a gated program that reads the checkout meets the unformatted files on the first `commit_checkout` and passes on the retry. submit_work got a window that lays the delta as nobody's around each judgement and withdraws it (`landing/land/formed.ts`, d21638e85b); this road has no `holders` to prime, so the same window applies without priming. Prove it with a test through `commit_checkout` whose judge records the working file and fails before the fix.