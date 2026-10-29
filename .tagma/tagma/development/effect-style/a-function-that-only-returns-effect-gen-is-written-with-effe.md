---
id: 01a13b76-3d46-78eb-b352-1c36df923180
title: A function that only returns Effect.gen is written with Effect.fn or Effect.fnUntraced; Effect.fn gains behaviour through its arguments, not .pipe
ord: 2
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-df923180",
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
An inline callback of the `(x) => Effect.gen(…)` shape, passed as an argument, is allowed.
