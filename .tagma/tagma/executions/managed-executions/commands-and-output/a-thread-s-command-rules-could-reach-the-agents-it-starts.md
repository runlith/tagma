---
id: 01a0cf38-c544-73bc-aae2-e564262324c5
title: A thread's command rules could reach the agents it starts
ord: 30
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
---
On 2026-09-23 the operator decided that a thread's rule binds that thread alone, and asked that this possibility be kept. The motivation: "every test in this thread runs at most 1 minute" is usually meant for the work the thread hands out as well. Reach would be chosen explicitly, for example by a flag on the rule (the thread only, or the thread and its descendants) or by a parameter at spawn. What would inform the choice: how often an operator repeats a rule to children, and whether a child ever needs a longer limit than its parent to do its work.