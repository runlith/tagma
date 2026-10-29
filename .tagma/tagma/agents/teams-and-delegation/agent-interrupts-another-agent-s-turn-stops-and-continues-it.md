---
id: 01a14bae-6720-7d62-897a-927b5e810ef5
title: Agent interrupts another agent's turn, stops and continues its child's run
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927a1d3e398d
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: supersedes
    to: 01a14b6d-b1e8-7dc1-8401-d789cd950139
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: file
    ref: packages/agent/src/collaboration/reach.ts
  - kind: file
    ref: packages/agent/src/collaboration/treeActs.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationTools.ts
    symbol: collaborationTools
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: CONTINUE_AGENT
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: INTERRUPT_AGENT
  - kind: symbol
    ref: packages/agent/src/collaboration/sendTools.ts
    symbol: sendTools
---
**Value.** The agent redirects another agent from the wrong path without losing its work, and resumes a failed agent without the operator.

**How.** The `interrupt_agent`, `stop_agent`, and `continue_agent` tools and operations.

**Behaviour.** Interrupting cuts the current turn short and opens the next one on a reason; an agent that is not working is left alone. Stopping is the same act as the operator's Stop: only the run's foreground work is stopped, background work and the CLI process stay. Continuing opens a new run over the child's saved history — stopped, failed, or cut short by a restart.

**Limits.** Its own thread and ancestors cannot be interrupted. Only its own child can be stopped and continued; another's thread — only with the operator's consent. A child whose last turn finished gets new work through an assignment, not a continue; a transport without continuation does not take it.
