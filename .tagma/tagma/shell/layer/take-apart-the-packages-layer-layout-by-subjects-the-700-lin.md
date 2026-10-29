---
id: 01a0f01e-4bcd-7ed1-89d7-891eb24693d3
title: "Take apart the packages/layer layout by subjects: the 700-line rule's debt"
ord: 23
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
The `packages/layer` area files standing in the [[6b3210c7|700-line rule]] debt under this task signal that the area's subjects are cut wrong; the current list and sizes come from `read_enforcement` on that rule.

First determine how far the cause goes: one file or the whole area; a large rework starts with a spec. Split by subjects, name each new file after its subject; the result is the area's layout, not a line count. If the limit is wrong for this class of files, that is the operator's decision and changes by rule through `enforce_rule`. The debt entry leaves when the violation is gone.
