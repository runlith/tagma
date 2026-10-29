---
id: 01a0e913-bdc6-71fc-85eb-11ebde968dac
title: "performance: retire first-run held-resources debt"
ord: 87
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e6ad-7bec-b72a-7c973951c2cb
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
Retire the 9 held-resources construction-site violations recorded for packages/performance in checks/held-resources.server.debt.json. Replace their ad hoc resource ownership with @runlith/held and prove the package's measured reach is clean.