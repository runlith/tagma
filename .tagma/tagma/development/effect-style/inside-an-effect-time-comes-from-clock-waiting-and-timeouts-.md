---
id: 01a13f2f-1301-7ee2-99a6-94e4673f881b
title: Inside an effect time comes from Clock, waiting and timeouts go through Effect — no Date.now(), new Date(), setTimeout, Promise.race, or Bun.sleep
ord: 8
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-673f881b",
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
