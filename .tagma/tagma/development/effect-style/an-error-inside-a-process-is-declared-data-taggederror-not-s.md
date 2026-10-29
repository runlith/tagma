---
id: 01a13b76-3d46-78eb-b352-1c3901ba3d55
title: An error inside a process is declared Data.TaggedError, not Schema.TaggedError
ord: 5
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-01ba3d55",
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
Whatever crosses a wire, a process pipe, a worker, or a journal is a schema form the boundary owner declares, with one projection from the error.
