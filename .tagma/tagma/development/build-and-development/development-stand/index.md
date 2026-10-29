---
id: 01a0c83c-e15d-738b-bdd7-5263883b9c98
title: Development stand
ord: 2
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/index.ts"
      }
    ],
    "id": "@runlith/dev-runner",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/dev-runner
---
A dev session is several processes meaningful only together: something prepares the tree, a server starts, a client aims at it. The package owns that supervision: preparation steps run in order, the participant with the ready URL holds the next until it answers, a participant with a changed artifact restarts alone, and one participant's exit ends the session unless the stand asked otherwise. Which processes form the stand and whose code runs on the already-answering URL is the caller's decision.
