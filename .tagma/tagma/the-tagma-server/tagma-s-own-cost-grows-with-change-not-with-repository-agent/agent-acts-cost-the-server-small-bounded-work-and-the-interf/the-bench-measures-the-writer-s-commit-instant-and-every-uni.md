---
id: 01a18f4f-b6c9-7354-a25f-a32c5bdeed02
title: The bench measures the writer's commit instant and every unit's hold and wait
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
---
Expose the instant COMMIT returned in the writer on a clock comparable across the machine's processes, and carry it through the existing reply to the causing Store unit. Measure every outer unit's physical writer wait and hold without span sampling, split hold into engine and outside-engine work, and expose operation-level distributions with honest quantile precision. Preserve all existing SQL, publication and acknowledgement boundaries; accounting stays bounded and cheap.