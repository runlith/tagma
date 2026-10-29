---
id: 01a0f01e-4bb5-7965-bbf0-3775175758d8
title: "Take apart the packages/agent area by subjects: a 650-line rule debt"
ord: 26
tags: ["task"]
fields:
  {
    "status": "done"
  }
---
Take apart the `packages/agent` area by subjects: a 650-line rule debt.

The `packages/agent` files standing in the [[6b3210c7|650-line rule]] debt behind this task signal that the area's subjects are cut wrong; the current list and sizes come from `read_enforcement` on that rule.

First establish how far the cause reaches: one file or the whole area; a large rework starts from a spec. Split by subjects, name each new file after its subject; the result is the area's arrangement, not the line count. If the limit is wrong for that file class, that is the operator's decision and changes the rule through `enforce_rule`. The debt record leaves when the violation is gone.
