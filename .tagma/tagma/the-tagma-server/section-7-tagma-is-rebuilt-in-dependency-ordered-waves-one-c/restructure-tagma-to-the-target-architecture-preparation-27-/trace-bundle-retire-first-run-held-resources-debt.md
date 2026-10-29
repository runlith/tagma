---
id: 01a0e913-be2f-7f64-aebb-efb30d728c61
title: "trace-bundle: retire first-run held-resources debt"
ord: 89
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e6b5-7385-ae60-f1574858b6e2
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
Retire the 4 held-resources construction-site violations recorded for packages/trace-bundle in checks/held-resources.server.debt.json. Replace their ad hoc resource ownership with @runlith/held and prove the package's measured reach is clean.