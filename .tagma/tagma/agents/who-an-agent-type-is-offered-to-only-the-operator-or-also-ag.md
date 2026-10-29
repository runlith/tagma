---
id: 01a14b6d-b241-74a6-b460-5e8bce16ebb5
title: Who an agent type is offered to — only the operator or also agents — is decided by its origin and the agent.offered setting
ord: 22
---
Not every agent type is available to agents: the operator decides which types its agents may launch themselves and which only the operator opens.

**Origin decides by default.** An agent in code, a CLI type, and the operator's personal file are offered to agents too: the personal floor is written by the operator or by an agent on the operator's word. A project file (`.agents`) and a plugin agent are operator-only: the repository and package authors write them.

**The `agent.offered` setting.** Records of `{"type": "<name>", "to": "operator" | "agents"}` override origin both ways; a later record wins, so a project answers over the machine. Only the operator writes it. The type a new thread opens by default is `agent.default`.

**Refusals.** A type that exists but is not offered to the agent is `type-withheld` with a reason and a way out ("the operator offers it to agents"), not `unknown-type`; a nonexistent one is `unknown-type` with a list of offered ones. The agent sees the types offered to it in the `spawn_agent` description; the operator — in `/agent` and `list_thread_types`.

Code: apps/tagma/server/src/threads/contract/wire/settings.ts#agentsOffered, apps/tagma/server/src/threads/library/declared.ts, packages/agent/src/collaboration/types.ts, packages/agent/src/collaboration/refusals.ts#PLANE_REFUSALS
