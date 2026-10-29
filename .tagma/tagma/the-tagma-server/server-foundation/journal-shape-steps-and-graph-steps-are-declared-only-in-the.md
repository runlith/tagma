---
id: 01a14ab3-9f4e-77d8-b7ba-6bf6a4d62ee7
title: Journal-shape steps and graph steps are declared only in their module's steps/ folder
ord: 26
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "step-places",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
edges:
  - kind: relates
    to: 01a14aa9-df12-7761-aebe-0e14f8616748
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
A step is a stored-shape migration, not live code: live code never imports it, only the module manifest wires it in, and serving receives graph steps through the `GraphSteps` port. Shared step navigation of one module lives in the same `steps/`.
