---
id: 01a0f01e-4bcf-74cb-93d7-a3474b32fa34
title: "Lay out packages/performance by subjects: debt on the 700-line rule"
ord: 18
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
Files of the `packages/performance` area standing in debt on [[6b3210c7|700-line rule]] behind this task signal that the area's subjects are cut wrong; the current list and sizes are given by `read_enforcement` on that rule.

First determine how far the cause reaches: one file or the whole area; a large rework starts with a spec. Split by subjects, name each new file after its subject; the result is the area's layout, not a line count. If the limit is wrong for this class of files, that is the operator's decision and changes by rule through `enforce_rule`. The debt record goes away once the violation is gone.
