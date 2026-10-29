---
id: 01a14b6d-b1da-7a37-88ca-b41fb1e344a7
title: Agent launches a child agent with a task, type, model, place, and history it chooses
ord: 2
---
An agent hands part of the work to a new child thread and goes on with its own. The child lives in its own thread, which the operator sees and can stop, and owes the parent a final answer.

**How.** The native agent's `spawn_agent` tool; its description lists the types this agent may launch. A thread of someone else's CLI calls the same-named operation over Tagma MCP on the thread's behalf from its grant. The operator creates a child through `create_thread` with `parent` and `task`.

**What the agent sets.**
- `agentId` — the type, resolved in the child's home; `task` — up to 20,000 characters. The child gets only the task and the birth note: who launched it, whom it owes an answer, its name, depth, and model.
- `provider`, `model`, `reasoning`, `switches` — by default the type-profile model, otherwise the parent's model.
- `name` — the address in the team, taken while the thread lives, even in the archive; without a name the address is the thread id.
- `fork` (`all`, `none`, or the last N turns) and `forkFrom` — copy its own history or that of a thread of its own subtree; the child stays its own anyway.
- `project` — the child's home (thread list, agent definitions, law) in another registered project; reports reach the parent.
- `worktree` — `inherit` by default, `new` for a fresh worktree from the parent's place, or the home's worktree name; `host` — only a kind/id a host operation returned (for example `prepare_sandbox`).
- `plain` — only on the operator's word: a native child takes each parent word as the operator's word, with no envelopes, birth note, or team.

A child inherits the parent's approval mode (a type with its own mode, for example a plugin agent, is born in `trust`) and its switches on the same model.

**Limits and refusals.** `delegation-off`, `depth-exhausted`; a taken name — `name-taken`; `unknown-type` / `type-withheld`; unserved model, rung, or switch — `model-unserved` / `reasoning-unoffered` / `switch-unoffered`; `fork` on a type whose transport takes no history (terminal CLI), and `plain` on a non-native type — `harness-contract`; `plain` with `fork` — `plain-fork`; `forkFrom` outside the subtree — `fork-outside`, a running source — `thread-running`; `project: global` — `global-home`. A call key makes spawn idempotent: a repeat answers with the same child, the same key with a different meaning — `key-reused` / `spawn-conflict`. Approval: review asks on every spawn, trust only on `worktree: new` (while `agent.worktrees = ask`) and `plain`, bypass asks nothing.

**Links.** The child's report; delegation and depth; model choice for the child; messages and assignments; branching.

Code: packages/agent/src/collaboration/collaborationVerbs.ts#spawnAgentInput, packages/agent/src/collaboration/CollaborationTools.ts#collaborationTools, packages/agent/src/collaboration/births.ts, packages/agent/src/collaboration/refusals.ts#SPAWN_REFUSALS, packages/agent/src/collaboration/CollaborationVoice.ts#collaborationBirth, apps/tagma/server/src/threads/operations/collaboration.ts#COLLABORATION_PAIRS
