---
id: 01a14c88-d8a5-72b1-b18e-4eef96171a9b
title: File watching
ord: 6
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/client.ts",
        "for": [
          "13182a9f",
          "edf810fe"
        ]
      },
      {
        "at": "src/cookie.ts",
        "for": [
          "d962023e",
          "c6922284",
          "5565be05"
        ]
      }
    ],
    "id": "@runlith/watch",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/watch
---
The server learns of file changes with no native watcher of its own: the kit starts a watch process over its Rust engine (FSEvents, inotify, ReadDirectoryChangesW), and a native-code crash does not bring down the server. The kit owns the engine, that process, its channel — a Unix socket any process finds the client by — the protocol of subscription, snapshot and change journal, and the client that starts the process when it is absent. What to watch, what to exclude and how to read events is the caller's call.
