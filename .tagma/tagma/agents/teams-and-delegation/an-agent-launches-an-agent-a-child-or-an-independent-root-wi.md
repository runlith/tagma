---
id: 01a14bae-6720-7d62-897a-9277306eedae
title: An agent launches an agent — a child or an independent root — with the task, type, model, place and history it picks itself
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92794b55f4da
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92819bf508ea
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9283445ee8a6
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928bb2581edb
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b429e21dd347
  - kind: supersedes
    to: 01a14b6d-b1da-7a37-88ca-b41fb1e344a7
sources:
  - kind: file
    ref: packages/agent/src/collaboration/births.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/collaboration.ts
    symbol: COLLABORATION_PAIRS
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationTools.ts
    symbol: collaborationTools
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: spawnAgentInput
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
    symbol: collaborationBirth
  - kind: symbol
    ref: packages/agent/src/collaboration/refusals.ts
    symbol: SPAWN_REFUSALS
---
**Value.** An agent splits large work between performers instead of holding it all in its context; every performer is a visible thread the operator can open, correct or stop. An agent carrying someone else's work without owning it births an independent thread with its own team.

**How.** The native agent's `spawn_agent` tool; the same-named operation for foreign-CLI threads through Tagma MCP. One birth with two choices: history (`fork`, `forkFrom`) and link (`link`).

**Behaviour.** A `child` link (default) births a member of the caller's team; `root` is a thread leading its own team outside the creator's tree: addressed by thread id, the creator's archive never touches it. The newborn receives only the task and the birth note — who launched it and whom it owes the answer; the birth task owes the creator a final answer under any link, and after the answer the root has no ties to the creator. It carries history only when told to copy it: all, the last N turns, or up to the chosen run — its own or any thread the caller can address; on the first turn the fork learns from the working note whose fork it is and that agents, tasks, lines and debt before the fork stay with the source ([[f7fd2c9d]]). The agent picks type, model, reasoning, switches, name, title, worktree (current, fresh or existing), sandbox and home project itself — the same for both links. With no model picked, the newborn takes its type's model, otherwise the history source's or the caller's model, and is born in the caller's approval mode. Repeating the same call answers with the same thread, not a second one. A plain child — only on the operator's word — takes every word of the parent as the operator's word, with no envelopes and no team. Who birthed the root and in which run is recorded in it.

**Limits.** Every birth is judged by delegation; depth caps only children — a root starts from zero. The type must be offered to agents. A terminal CLI takes no history copy, and a CLI thread never shares its own. Only a child can be plain. Stopping, continuing, re-modelling, archiving and rewinding a born root need the operator's consent, like for any non-descendant. Models and rungs marked operator-only are downgraded without the operator's word. A plain child already asks in trust mode; a fresh worktree in review, and in trust only with `agent.worktrees: ask`.
