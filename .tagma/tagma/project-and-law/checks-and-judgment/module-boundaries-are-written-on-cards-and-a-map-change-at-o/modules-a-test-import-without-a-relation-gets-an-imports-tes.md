---
id: 01a164f3-0780-77b5-9cb1-f796e7930ed0
title: "`modules`: a test import without a relation gets an `imports-tests` fix, and a test-only relation doesn't close the cycle"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164f2-2783-71c2-94b4-ac7fcae5f4dc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a164f1-fc40-73ec-8f3f-c3f4ac2867a2
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/declaration.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
---
An import from a test file into a module without a relation gets a fix with a working relation that would open working code; the fix must name `imports-tests`. The map cycle is judged by working relations: `imports-tests` opens a module to test code only — a lower module may be tested through an upper one — so such a relation doesn't close the cycle. The `modules` description and the `rules` skill say the same.
