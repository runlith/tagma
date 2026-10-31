---
id: 01a1941f-f2bb-77f3-9717-6552f7c18c7c
title: Release the activity-window fixture after successful tests
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52933fdfb4c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a188a5-13ca-7b6e-90ca-0f165186ea95
---
Reproduce the activityWindow fixture teardown hang with its original seed and resource ownership, identify which finalizer or held process is waiting, and fix that owner. Preserve the tests' contract and hang guard, run only the affected files, and retain evidence of resource release instead of replacing a fact with a timer.