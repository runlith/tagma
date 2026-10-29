---
id: 01a0f01e-4ba9-7d42-ab55-e7bae239d4dc
title: "Break down the Tagma app's structure by subjects: a 700-line rule debt"
ord: 42
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0e3d68e71ff
---
Tagma app area (`apps/tagma/app`) files standing in the [[6b3210c7|700-line rule]] debt behind this task signal that the area's subjects are cut wrong; the current list and sizes come from `read_enforcement` on that rule.

First establish how far the cause reaches: one file or the whole area; a large rework starts with a spec. Split by subjects, naming each new file after its subject; the result is the area's structure, not a line count. If the limit is wrong for this class of files, that is the operator's call and changes by rule through `enforce_rule`. The debt entry leaves when the violation is gone.
