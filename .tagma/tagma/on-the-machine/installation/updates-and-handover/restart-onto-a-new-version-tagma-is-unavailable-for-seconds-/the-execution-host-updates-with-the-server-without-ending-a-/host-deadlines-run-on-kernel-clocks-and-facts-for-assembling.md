---
id: 01a1271e-2479-7971-9b0c-4ec8c35942b0
title: Host deadlines run on kernel clocks, and facts for assembling an execution lie in its store
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/CallLifetimes.ts
  - kind: file
    ref: packages/execution-host/src/Pacing.ts
  - kind: file
    ref: packages/execution-host/src/ProgramRules.ts
---
In the line's worktree. The logic runtime `Clock` reads kernel clocks through the native library (`CLOCK_UPTIME_RAW` on macOS). Written into `executions.sqlite`: at start — the `call` and `paced` budget (`registry/assembly.ts:37-42,143-146`); as they arise or change — the call arming instant (`CallLifetimes.arm`), the program rule deadline (`ProgramRules`), and the pace (`Pacing`). Owners open from what was saved. If the picked clocks behave in sleep differently from the current `process.hrtime`, the task names that change. Proven by an integration test: a call armed in one process and a program rule bound in it fire at the same moment after opening in the second process, with the same budget and pace.
