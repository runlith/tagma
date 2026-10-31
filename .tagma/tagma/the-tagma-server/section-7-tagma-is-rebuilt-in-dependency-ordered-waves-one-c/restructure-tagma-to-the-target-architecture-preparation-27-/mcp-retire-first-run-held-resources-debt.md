---
id: 01a0e913-bda2-786d-ac18-b5d83aa55c40
title: "mcp: retire first-run held-resources debt"
ord: 86
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e72b-764e-aecf-9a7ee8918b55
---
Retire the 3 held-resources construction-site violations recorded for packages/mcp in checks/held-resources.server.debt.json. Replace their ad hoc resource ownership with @runlith/held and prove the package's measured reach is clean.