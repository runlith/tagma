---
id: 01a13b76-3d46-78eb-b352-1c358fcfef49
title: "An Effect service is written as closures in make: no class implementing its tag, no const self = this, no { self: this }"
ord: 1
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-8fcfef49",
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
sources:
  - kind: dir
    ref: apps/tagma/app
  - kind: dir
    ref: apps/tagma/server/src
  - kind: dir
    ref: packages
---
Classes remain for data, errors and low-level primitives.
