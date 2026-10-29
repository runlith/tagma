---
id: 01a16519-471e-7683-96c8-edf22c1b1683
title: "Test \"removing a project ends the turn and the CLI of its agent\" is unstable under load: CLI session reads as `stopping`, not `ended`"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164ef-27a7-776d-9e6b-92076e26b62c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16506-c0ca-7651-aa2b-0934f2b6b4b7
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/threadArchive.stest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
---
`threadArchive.stest.ts`, test "removing a project ends the turn and the CLI of its agent and keeps the thread unarchived", sometimes fails on `expect(session.state).toBe('ended')` with `stopping`. This read happens right after `ProjectLifecycle.remove`.

Measured 2026-10-22: it failed in a file run under parallel load from other sessions, and in a solo run where the status write made an extra request to the SQLite process. The archive-mark subscription never fired in the failed runs. On delivery commit f2b6b4f7 the same file passed 3 of 3, and failed once in a loaded run.

Apparently `ThreadEnding.closeProject` answers before the CLI session reaches `ended`: the session stop is only requested. Or the test reads the state without waiting for the fact. Need to determine which of the two, and wait for the fact at its owner or in the test.
