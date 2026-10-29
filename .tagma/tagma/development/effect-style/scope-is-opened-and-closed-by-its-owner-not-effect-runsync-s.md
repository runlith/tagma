---
id: 01a13b76-3d46-78eb-b352-1c38373e29e4
title: Scope is opened and closed by its owner, not Effect.runSync(Scope.make())
ord: 4
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-373e29e4",
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
The owner takes the layer scope (yield* Effect.scope in make), acquireRelease, or Effect.scoped.
