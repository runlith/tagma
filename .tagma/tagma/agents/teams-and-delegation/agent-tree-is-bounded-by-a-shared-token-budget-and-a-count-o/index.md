---
id: 01a14be4-2437-75af-92bd-b429e21dd347
title: Agent tree is bounded by a shared token budget and a count of concurrently working sub-agents
ord: 10
tags: ["feature"]
fields:
  {
    "state": "dormant"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/mandate.ts
  - kind: file
    ref: packages/agent/src/collaboration/births.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationResidency.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunAccounting.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/spawnLimits.ts
    symbol: spawnLimits
---
**Value.** Intended so the operator bounds how many tokens one root's whole team may spend and how many sub-agents work on the server at once, instead of finding an exhausted quota after a night of agent work.

**How.** By nothing: no operation, setting, or screen sets a root budget or the server slot count.

**Behaviour.** The code holds both bounds: a child launch refuses when the tree spent its budget or all slots are taken, and run accounting counts spending against the root's budget. The collaboration voice warns agents about a "budget and slots" bound, and the budget refusal offers the way out "the operator raises the tree budget", which does not exist. The mechanism is left in the code deliberately as unfinished.

**Limits.** Until a root budget is set and slots are declared, none of these refusals triggers.
