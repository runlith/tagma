---
id: 01a1ae21-c7c5-7048-8ea5-b70ae79cdeb4
title: The step back's two phases depend on no module code they do not need, and a stop during the journal return stops the server
ord: 53
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee476cec84de
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/returning.ts
---
The CLI phase of a step back (`returnedBeforeServing`) loads every module's code through `build.parts` only to read the stores' full-text fills; a failing load is now non-fatal, but a hang or crash in module init still stops the store carry the phase exists to make independent of server code. The fills are a fact of the store chain and belong in a declaration that loads no module code. In the server phase, SIGTERM or SIGINT during a long journal return only marks the Succession stopping, so the restart refuses `stopping` and the server boots and serves until the signal escalates to SIGKILL; the journal phase also builds a second Succession with its own signal listeners. Done when the CLI phase loads no module code and a stop during the journal return ends the process.