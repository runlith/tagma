---
id: 01a0de2b-893f-7ea4-9055-b58f9479f781
title: A turn's stop ends only the commands and invocations that run started, never an earlier turn's background work
ord: 114
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de17-2c68-7a3d-95dd-c204a488f8a5",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/ending.ts
    symbol: ThreadEnding
---
`ThreadEnding.stop` swept every command the thread owned under `run-abort` and ended every invocation of the thread, so one stopped turn killed background services earlier turns had launched with `timeout: "none"` ([[c7266bee]]). The stop now names the run it ends (the caller's, or the one going), the command sweep and `AgentCalls.end` narrow to that run, and commands no run is recorded for (git, rule programs) still go with it. Proof: `ThreadEnding.test.ts` and the run-scoped sweep in `commandAdmission.itest.ts`.