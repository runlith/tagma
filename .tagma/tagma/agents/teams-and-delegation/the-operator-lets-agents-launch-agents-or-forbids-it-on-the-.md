---
id: 01a14bae-6720-7d62-897a-92780a5d8623
title: The operator lets agents launch agents or forbids it — on the machine, on a thread and its team; a setting caps the nesting depth
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9283445ee8a6
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928951e208b5
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b429e21dd347
  - kind: supersedes
    to: 01a14b6d-b1de-7e1a-a118-4a1362b40677
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/delegation.commands.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/TeamChip.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/birth/delegation.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: delegation
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: subAgentDepth
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/acts.ts
    symbol: ACT_PAIRS
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
    symbol: delegationNotice
  - kind: symbol
    ref: packages/agent/src/collaboration/spawnLimits.ts
    symbol: spawnLimits
---
**Value.** The operator decides when an agent may launch other agents and when to work alone — for the whole machine or one team — and keeps the agent tree from going deep.

**How.** The Team/Solo pill in the composer, the `/delegation` command, the `set_thread_delegation` operation (only on the operator's word), the `agent.delegation` and `agent.subAgentDepth` settings.

**Behaviour.** The nearest switch up the spawning lineage decides, otherwise the machine one; a thread can be returned to inheriting. A working agent learns about the switch at its next step. Switching off forbids only the agents' own new launches: an agent the operator asked for in his words, or a reviewer his review policy calls for, still starts with `operatorAsked`, and the thread stays Solo; running agents are still messaged, stopped and continued, and they report. At birth a child is told its depth and how many floors remain.

**Limits.** Delegation judges every agent birth, independent root and history copy included; depth judges only children — a root starts from zero. Depth caps only new launches, so a detached thread returned to its place may stand deeper.
