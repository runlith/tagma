---
id: 01a1615e-1452-73af-bdf5-74f5f4d614a5
title: write_setting answers with the written key and its effective value
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1615d-9c1f-7fa1-9105-34bae56551da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a155cd-14d5-71af-ad03-e34163202d5b
---
Fix the `write_setting` producer answer: return the project, key, new effective value and its source instead of a catalog. Check the app and CLI consumers and the minimal public contract of writing and clearing.
