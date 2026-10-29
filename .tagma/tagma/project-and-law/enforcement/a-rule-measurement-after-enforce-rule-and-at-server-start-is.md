---
id: 01a160b0-8e4e-71ca-8f06-b87161ee8657
title: A rule measurement after enforce_rule and at server start is recorded at 0 ms for a program inspection
ord: 153
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160b0-adc3-78d5-858f-3f4cc98e57dc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15e24-bb7c-71f4-bf3e-41c3320acd1c
---
After `4391326016` program-inspection durations reach check_rules and the post-landing remeasurement (law-lab, `39/4e5d1446`, ESLint: "measured … in 402 ms" after submit_work `f0a328b7f0`). But the remeasurement after `enforce_rule` (the same enforce reported "measured … in 0.7 s" itself, while `read_enforcement` recorded "in 0 ms" at 22:56:25) and the remeasurement at server start (22:14:45, "in 0 ms" against 99 ms for the builtin) write 0 ms. Find the remeasurement path(s) that do not take the `ProgramRun` time, and fix at the producer so every recorded measurement carries the real run time.
