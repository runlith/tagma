---
id: 01a1355b-accf-7a29-b994-7888a7ae240f
title: An agent's owed report yields like operator words, and a foreground line of sleep and empty commands is refused
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13548-2107-784e-bf1e-c14b591e5f44",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0f3e0-df87-7dfb-bfa9-8b15356d0443
sources:
  - kind: file
    ref: packages/agent-tools/src/shellShapes.ts
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
---
An agent's owed report yields like operator words, and a foreground line of sleep and empty commands is refused.

Thread 01a13517 twice slept through its reviewers' reports: `sleep 280; echo waited` with `waitMs: 300000`. The trailing `echo` carried the line past the `shellOnlySleeps` refusal, and only operator words interrupted the wait. Review reports from review-opus and review-races lay queued behind the sleep for about three minutes (reflection 39e8b6e1).

To do:
- `shellOnlySleeps` refuses a line in which `sleep` stands beside only `echo`, `printf`, `true`, `:` or `date` with literal words and no file write. The refusal text says to await one's own agent by ending the turn.
- A `report` signal yields like operator words: a call that only awaits ends with its own `wait-ended` answer, a foreground command moves to background.

Proof: `AgentCalls`, `AgentRunner`, and `shellShapes` unit tests for both cases, `packages/agent` and `packages/agent-tools` typecheck.
