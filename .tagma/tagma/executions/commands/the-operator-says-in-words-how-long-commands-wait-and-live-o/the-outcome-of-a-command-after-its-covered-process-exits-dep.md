---
id: 01a16ed2-9ca7-7c33-81c6-77432568a1b2
title: The outcome of a command after its covered process exits depends on a race with the expired default term's recovery
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
After measuring, pin down the command semantics after the exit of a process covered by a program rule, and remove the outcome's dependence on the order of observation and finalization. Whole-package seed 1 in `packages/execution-host/src/hostProcess.itest.ts` gave `Cancelled` instead of `Completed` for `sleep 2; echo done` after ≈2142 ms: default 1500 ms, sleep covered by a 20000 ms rule. `ProgramRules.ts:358–367` returns the expired default to the current elapsed after sleep exits; the shell either finishes or is cancelled, so `done` may or may not print. Removing the unreliable Completed expectation keeps the native check of the term's return and the unit coverage of the extension, but does not settle this semantics.
