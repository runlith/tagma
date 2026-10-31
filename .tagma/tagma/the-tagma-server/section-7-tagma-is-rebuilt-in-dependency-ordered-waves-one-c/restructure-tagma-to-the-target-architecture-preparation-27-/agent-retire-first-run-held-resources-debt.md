---
id: 01a0e913-bcf7-7a4d-978d-d7c0cf772c9c
title: "agent: retire first-run held-resources debt"
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e6fa-7f7e-af9e-8c34052dc52d
---
Retire the 8 held-resources construction-site violations recorded for packages/agent in checks/held-resources.server.debt.json. Replace their ad hoc resource ownership with @runlith/held and prove the package's measured reach is clean.