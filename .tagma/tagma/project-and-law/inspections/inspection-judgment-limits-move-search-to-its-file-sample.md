---
id: 01a12d35-b1d1-7300-98a5-07358d5fbe53
title: Inspection judgment limits move search to its file sample
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12ca5-9b00-782c-b335-f94f225b8327",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12b5a-2590-770f-91a0-ec8ac687c34e
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/node/judge.ts
---
In the shared judge, fix the move search that parses binary assets and non-module workflow scripts outside the inspection sample on directory moves; keep carrying standing violations and the refusal on a corrupted sampled source. Separately reconcile the old modules refusal on 80 MiB at merge against the current code and contracts. Completion is confirmed by red→green through the public judge, narrow checks, independent review and a commit; the original large operations and the operator's running server are not repeated.
