---
id: 01a1957a-1784-7037-be6e-a1043483f789
title: Keep a background tool invocation in its call span
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19578-b13d-7fad-9064-85dfe72d73a8",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19578-7e70-7ca7-ba04-4194cdc3f56c
---
Keep a background tool invocation under its own span across preparation, execution and delivery, so child compaction and other collaboration calls can finish and report their outcomes.