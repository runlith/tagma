---
id: 01a14c37-8e23-7631-86c7-f251f2491ef5
title: The showcase skill and the installed OPERATIONS.md must know the built-in browser
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
---
The showcase skill (`native-harness/skills/showcase.ts`) tells writers to take headless Playwright, while spec f3ea399e calls for the built-in browser. The committed `.agents/skills/tagma/OPERATIONS.md` holds none of the browser operations (352 of 382), although rendering includes them — the copy is stale. Reconcile once the default-agent browser idea is decided.
