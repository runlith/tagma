---
id: 01a0e913-bd50-7394-b472-b7a568f864a8
title: "llm: retire first-run held-resources / blocking-calls debt"
ord: 85
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e702-7e20-a06d-e9690d701139
---
Retire the 4 held-resources construction sites and 3 blocking-calls synchronous I/O sites recorded for packages/llm in checks/held-resources.server.debt.json and checks/blocking-calls.server.debt.json. Prove both measured reaches clean without changing their package contracts.