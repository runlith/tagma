---
id: 01a13b76-3d46-78eb-b352-1c3ad270a238
title: An Effect-code test runs effects through @runlith/effect-test, with no Effect.runPromise, Effect.runSync or ManagedRuntime in the test file
ord: 6
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "effect-style-d270a238",
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
`it.effect` is test clocks and console, `it.live` is real time, `layer(…)` is one layer per group; a double is substituted under its own tag.
