---
id: 01a18ecf-2fa3-7cdc-865e-80d193eeac21
title: Keep type-only forwarding out of runtime callers
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "done"
  }
---
Declaration forwarding loses type-only modifiers, so a type re-export makes an exported function appear called. Preserve the type/value distinction for statement, specifier and local forwarding and prove it through the dead-code inspection.