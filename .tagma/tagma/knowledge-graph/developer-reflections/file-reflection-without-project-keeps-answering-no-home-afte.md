---
id: 01a168e1-1341-76fc-9433-635a61fcdbf5
title: file_reflection without project keeps answering no-home after the source checkout's successful registration
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "In the in-process door world the first file_reflection gave no-home; add_project for source and file_reflection with project=other passed; the next file_reflection without project gave 409 no-home again: no registered project covers the running server's own source.",
    "command": "bun test ./src/composition/testing/http/reflectDoor.stest.ts -t 'a reflection from another project'",
    "expected": "After the first no-home and the successful add_project for the source checkout, file_reflection/read_reflections calls with no explicit project find the same source graph as a call from the explicitly named other project."
  }
---
Filed from project `runlith`.

Repro: composition/testing/http/reflectDoor.stest.ts; the sourceCheckout was made a real repository with an initial commit before registration, set_module succeeded. The file checks the order no-home → add_project → filing from another project → filing without project. The last refusal came from graph/operations/crossing.ts reflectionPlace: SourceProject kept the ProjectPlace read before the first commit, and after registration gave projects.resolve the old repoKey. The context of the first opened other project already set the current git identity. Reading cost — several failing test runs; no separate server or restart.
