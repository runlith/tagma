---
id: 01a0c6f6-d554-7abd-b393-11ca347ec114
title: Build the zone for packages/utils
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6f7-7fba-7b86-bdb9-a49ba15fd5dd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/utils
---
Wave 0, builder alone: `packages/utils` (2,285 tracked non-test lines, 64 files of small helpers) is a module by construction; areas by concern where the helpers group. Reviewer, then the head accepts per the decision.