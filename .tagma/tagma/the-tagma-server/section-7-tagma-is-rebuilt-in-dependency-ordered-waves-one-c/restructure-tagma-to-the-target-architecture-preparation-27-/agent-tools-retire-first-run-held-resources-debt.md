---
id: 01a0e913-bd0c-7950-825f-fe9f16f3e252
title: "agent-tools: retire first-run held-resources debt"
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e713-71b1-9af0-eca1dad05c72
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
Retire the 4 held-resources construction-site violations recorded for packages/agent-tools in checks/held-resources.server.debt.json. Replace their ad hoc resource ownership with @runlith/held and prove the package's measured reach is clean.