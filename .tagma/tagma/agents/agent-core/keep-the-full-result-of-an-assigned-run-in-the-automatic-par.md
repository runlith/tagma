---
id: 01a1515e-b591-71fa-a281-4d2b12c8a6a7
title: Keep the full result of an assigned run in the automatic parent report
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-445a-7cff-ab48-5d68e0654ba4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1512b-025b-72e6-8c1b-9b077a9265fa
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.test.ts
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: packages/agent/src/collaboration/reporting.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
---
Fix the result loss in the reflection at the turn-boundary owner: the answer belongs to the run that took the assignment, and a later message does not replace it. The journal established that full audit (#404) and short confirmation (#416) share one runId: AgentTurn continued an already-finished text answer for a signal arriving mid-generation; the next tool call pushed the full answer out of closingAnswer. The public check of the run result reproduced the swap: expected "First answer.", received "Read you."; after the fixes 93 delivery, lifecycle, and step-boundary tests passed plus bun run typecheck in packages/agent. An independent review of the whole delivery found one more window: a new run could inherit a delivered request between completed write and report publication. Completion now saves the handled-request set and confirms it in one transaction; the report reads the saved set. The public check reproduced the deliveredToRunId move from run-answered to run-later. The running server was not restarted.
