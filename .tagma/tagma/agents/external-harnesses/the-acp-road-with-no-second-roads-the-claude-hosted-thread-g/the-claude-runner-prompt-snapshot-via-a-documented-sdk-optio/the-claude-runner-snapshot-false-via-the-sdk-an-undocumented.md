---
id: 01a11401-0fc2-7ae2-9e45-3dacc5415551
title: "The Claude runner: snapshot: false via the SDK, an undocumented-call adapter, ClaudeSession by subject, contract tests on a fake SDK"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11401-c730-781b-af87-31c42e9a2949",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a113ff-0d62-74ec-ae7c-e9144acce69d
  - kind: waits-on
    to: 01a11401-0fc2-7ae2-9e45-3daa8e42577c
---
Do everything spec [[4acce69d|Claude runner]] describes, in `apps/tagma/server/src/external-harnesses/runner/claude`.

Done when the fake-SDK contract tests and the live smoke pass, `SNAPSHOT_FLAG_VERSION` is deleted, and notes d0810682 and f3949b43 are rewritten.
