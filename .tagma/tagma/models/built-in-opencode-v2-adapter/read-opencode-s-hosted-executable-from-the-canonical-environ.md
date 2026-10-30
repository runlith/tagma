---
id: 01a18e9d-7d41-77d4-a138-74f37597e7ad
title: Read OpenCode's hosted executable from the canonical environment key
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac9d-7548-8cab-9f3a51c4dec2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18e9b-c4a9-7c9a-8d63-960d1488321a
---
The OpenCode host selector reads HARNESS_PROGRAM instead of TAGMA_HARNESS_PROGRAM, so it ignores the runner executable the launch selected. Use the hosted protocol's declared key and prove the selected executable reaches the real host boundary.