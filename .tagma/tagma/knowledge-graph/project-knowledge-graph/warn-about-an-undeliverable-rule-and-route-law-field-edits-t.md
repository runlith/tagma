---
id: 01a165a2-be8f-7ab8-b907-916fd9086033
title: Warn about an undeliverable rule and route law-field edits to their operations
ord: 98
tags: ["task"]
fields:
  {
    "holder": "tagma:01a165a2-48e5-7606-bbfc-86689e5201fd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a165a2-014a-7d93-be76-6b00ddff721b
---
Fix set_rule_delivery code without sources: warn explicitly about undelivered text and unchanged check scope. Align rule-disabled with set_rule_enabled and verify that update_block does not write operation-owned fields.
