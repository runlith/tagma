---
id: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
title: "The core knows no variants: everything depending on technology, platform or vendor is an adapter behind the core's contract"
ord: 9
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "vendor-ids",
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
    ref: .
---
A variant is an OS, runtime, library, format, protocol, or vendor API that may grow a second variant. The core works only through its contract: no imports, no adapter enumeration, no branching on variant. An adapter in its own module implements the whole contract and declares itself; composition connects. A new variant doesn't change the core or other adapters. If a universal mechanism is good and fast enough, no adapter is started.
