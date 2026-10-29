---
id: 01a0f82d-385d-76b2-bd64-050128bf9231
title: "Remove the fork right: every agent forks itself through spawn_agent `fork` and any thread it can address through fork_thread, with no grant, check or option"
ord: 125
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f82a-c94f-7f67-8af6-4496b32c9e40",
    "status": "done"
  }
---
Operator's order, relayed by law-opus on 2026-10-01: no rule about whether an agent may fork itself or another thread may exist; forking is an ordinary ability of every agent. Observed: spawn_agent with `fork: 6` refused `Agent tagma holds no right to fork.`

**Do**
- `ThreadRightsVector` keeps `interrupt` alone (interrupt is a separate power and stays); `fork` leaves the vector, its schemas (`threadRightsSchema`, the agent profile, the agent-definition frontmatter wire, spawn_agent's `rights`), the spawn and branch edge checks in `ThreadSpawnTree`, and `fork_thread`'s catalog gate in `historyTools`.
- Tool descriptions and the collaboration prompt and birth header name no fork right (rule d82432e6).
- Stored rows: a data migration drops the retired `fork` (and the earlier retired `spawn`) key from stored rights in Tagma's `thread_mandate`; old rows and old agent files carrying `fork` still decode.
- Forking another thread is `fork_thread`, whose access is the owner's, the same as reading the thread.

**Where:** `packages/agent/src/thread/rows.ts`, `persisted.ts`, `collaboration/{ThreadSpawnTree,historyTools,CollaborationTools,CollaborationVoice}.ts`, `thread/agents/AgentProfile.ts`, `apps/tagma/server/src/threads/contract/wire/agentLibrary.ts`, migrations, fixtures.

**Done when:** a contract test shows an agent holding no rights forks itself through spawn_agent and forks another thread through fork_thread; typechecks pass; affected claims rewritten from the code; a Sol high review's holding findings fixed.