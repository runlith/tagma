---
id: 01a15047-9f13-783e-8bcb-cfa355b6c962
title: Carry all program finding sites into the check_law and gate answers
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15047-0f6a-7306-b227-978d6a3a839d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15046-0e44-7ad6-903c-0011579bf436
sources:
  - kind: file
    ref: apps/tagma/inspection/src/core/program.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/group.ts
---
ProgramFinding and the server projection preserve sites; change judgement expands them after the fingerprint count, like builtins, and full measurement preserves the unit for debt. The program environment passes real sites instead of appending lines to message. The minimal test goes through the gate and check_law over a change; 19 affected tests, the inspection typecheck, and checks/law passed. The overall server typecheck stays unconfirmed: 44 errors in commitChecks.stest.ts, commitGate.stest.ts, commitHooks.itest.ts, ownGit.stest.ts, and packages/agent/src/thread/run/scheduler/openings.ts outside this task's edits. An independent review (openai-oauth/gpt-6.1-sol, xhigh) found the empty-sites `[]` gap: the contract now refuses it, confirmed by the red→green readProgramAnswer test.
