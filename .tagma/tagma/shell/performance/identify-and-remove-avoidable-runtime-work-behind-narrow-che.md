---
id: 01a1941f-f2bb-77f3-9717-65530dcb1f38
title: Identify and remove avoidable runtime work behind narrow-check starvation
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52933fdfb4c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13fbb-68e2-7b63-b559-c6ffde3c8217
---
Investigate the reported server CPU and memory saturation with current bounded diagnostics and isolated targeted measurements. Establish causation before changing code, separate machine contention from Tagma work, and fix an evidenced cost at its producer. No new diagnostics feature, operator-setting change, full suite or live product launch is authorized by this investigation.