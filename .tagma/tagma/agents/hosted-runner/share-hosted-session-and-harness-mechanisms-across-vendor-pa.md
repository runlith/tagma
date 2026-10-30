---
id: 01a18e92-210c-7360-a62a-354692919053
title: Share hosted session and harness mechanisms across vendor packages
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac9d-7548-8cab-9f3a51c4dec2",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
Move the duplicate Cursor/OpenCode prepared-turn lifecycle, configuration and hosted profile into the private runner kit, and share stdio, terminal navigation and hook-format encoding at their lowest owners. Preserve each vendor's session semantics and move every consumer in the same change.