---
id: 01a164ef-5b45-7ba6-b7f1-fe941d75339e
title: Name an inconsistent module map with its own refusal in set_module and rule judgment
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164ee-bc31-712a-aec7-695384cfff34",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a164ee-a2e1-7c4d-9108-11d49b754eef
---
Fix the bad-map refusal producer: a link cycle in set_module must give a map condition with an exit for that call; enforce_rule and landing must keep the same meaning. Prove the scenario with a thread-called set_module, check typecheck and an independent review.
