---
id: 01a0f01e-4bc4-789f-9f83-3e7e2d5c76ec
title: "Split the packages/chat-ui device by subjects: 650-line rule debt"
ord: 21
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0df16997c14
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e618d547b2
---
Files of area `packages/chat-ui` standing in the [[6b3210c7|650-line rule]] debt behind this task are a signal that the area's subjects are cut wrong; the current list and sizes are given by `read_enforcement` on this rule.

First find how far the cause reaches — one file or the whole area; a large rework starts from a spec. Split by subjects, name each new file by its subject; the result is the area's mechanics, not a line count. When the limit is wrong for a class of these files, that is the operator's decision and changes the rule through `enforce_rule`. The debt entry leaves when the violation is gone.
