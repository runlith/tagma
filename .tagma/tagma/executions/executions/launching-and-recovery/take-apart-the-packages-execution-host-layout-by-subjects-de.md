---
id: 01a0f01e-4bc7-7e34-9fda-b8f02ea22ce5
title: "Take apart the packages/execution-host layout by subjects: debt of the 700-line rule"
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
The files of the `packages/execution-host` area standing in the debt of [[6b3210c7|the 700-line rule]] behind this task signal that the area's subjects are cut wrong; the current list and sizes come from `read_enforcement` on that rule.

First establish how far the cause reaches: one file or the whole area; a large rework starts from a spec. Split by subjects, naming each new file after its subject; the result is the area's layout, not a line count. If the limit is wrong for this class of files, that is the operator's decision and changes by rule through `enforce_rule`. The debt entry leaves once the violation is gone.
