---
id: 01a15417-b33a-7058-b932-71f13b8232d4
title: Program judgement runs together with builtin-rules judgement
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15419-5394-73d2-a177-567bb9cb08f1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
---
In `judgement`, builtin rules start only after `judgeBindings`, while the programs process stands ~2.6 s per judgement. First prove from code that builtin rules need no program results: `mergingOf` and `againstParents` use them. Then run both judgements concurrently without changing verdicts or refusals. Proof: an owner test on the verdict and `check_law` staged before and after on one index — total time drops by about the programs' time.
