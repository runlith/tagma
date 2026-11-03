---
id: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
title: Interprocess file lock
ord: 5
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/flock.ts",
        "for": [
          "edf810fe",
          "00ddf0e5",
          "249ce587",
          "ac293dd5",
          "96171a9b",
          "feef9784",
          "a287d79f"
        ]
      },
      {
        "at": "src/FileLock.ts",
        "for": [
          "edf810fe",
          "00ddf0e5",
          "249ce587",
          "6cc306ce",
          "1ad089ea",
          "287a4906",
          "d2a60527",
          "90491249",
          "a287d79f",
          "360417ba"
        ]
      }
    ],
    "id": "@runlith/file-lock",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/file-lock
---
So two processes never hold the same thing, the package gives exclusion through the kernel's advisory flock, released together with the owning process, and scoped holding over it. What to guard with the lock is the caller's decision.
