---
id: 01a14bae-6720-7d62-897a-92876d791728
title: "Agent sees all of the owner's agents in one call: who works, waits, or is stuck, how the run ended, how much context and cache remain"
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b427b7bf6486
  - kind: supersedes
    to: 01a14b6d-b229-7a67-9d74-9d0364c274e9
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/collaboration.ts
    symbol: COLLABORATION_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: packages/agent/src/collaboration/agentRoster.ts
    symbol: readRoster
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: LIST_AGENTS
---
**Value.** A lead agent does not need to open feeds to know what the team does and who needs a new assignment; the operator reads the same for any threads.

**How.** `list_agents` for the agent; `read_statuses` and `read_endings` for named threads.

**Behaviour.** Working agents go first. An agent with no durable movement longer than allowed counts as stuck: a heartbeat is no progress. A failed run shows the failure type, the provider, and repeatability; every agent shows context fill against the auto-compaction point and prompt-cache warmth. A run ending whose notification never arrived can be delivered again.

**Limits.** A name addresses only inside its own team, others by thread id. A thread that does not exist or lives in another project refuses with its own row, not the whole page.
