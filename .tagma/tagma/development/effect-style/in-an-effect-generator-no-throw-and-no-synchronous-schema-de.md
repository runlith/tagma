---
id: 01a13b76-3d46-78eb-b352-1c37bc8f1e15
title: "In an effect generator no throw and no synchronous schema decoding: failure is a typed error, decoding is decodeUnknownEffect"
ord: 3
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-bc8f1e15",
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
Outside code that throws is wrapped in `Effect.try({ try, catch })`. `throw` in a nested plain function is not judged by the check.
