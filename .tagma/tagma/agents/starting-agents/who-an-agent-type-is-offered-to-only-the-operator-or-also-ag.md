---
id: 01a14bae-6720-7d62-897a-928bb2581edb
title: Who an agent type is offered to — only the operator or also agents — is decided by its origin and the agent.offered setting
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: supersedes
    to: 01a14b6d-b241-74a6-b460-5e8bce16ebb5
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/library/declared.ts
  - kind: file
    ref: packages/agent/src/collaboration/types.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: agentsOffered
  - kind: symbol
    ref: packages/agent/src/collaboration/refusals.ts
    symbol: PLANE_REFUSALS
---
**Value.** The operator decides which agents its agents may launch themselves and which only the operator opens: an agent from someone else's repository or package does not become a performer without the operator's consent.

**How.** The `agent.offered` setting; written by the operator only.

**Behaviour.** Origin decides by default: a built-in agent, a CLI type, and a personal file are offered to agents; a project file and an app agent — to the operator only. The setting overrides it both ways, project over machine. An agent sees the types offered to it in the `spawn_agent` description.

**Limits.** A withheld type refuses an agent separately from a nonexistent one and names the way out: the operator offers it to agents.
