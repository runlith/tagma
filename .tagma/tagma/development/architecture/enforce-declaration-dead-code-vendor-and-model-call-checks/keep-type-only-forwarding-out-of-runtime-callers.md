---
id: 01a18ecf-2fa3-7cdc-865e-80d193eeac21
title: Keep type-only forwarding out of runtime callers
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "in_work"
  }
---
Declaration forwarding loses type-only modifiers, so a type re-export makes an exported function appear called. Preserve the type/value distinction for statement, specifier and local forwarding and prove it through the dead-code inspection.