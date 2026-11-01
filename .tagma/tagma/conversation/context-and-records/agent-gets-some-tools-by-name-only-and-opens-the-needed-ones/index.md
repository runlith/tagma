---
id: 01a14bc0-766c-7277-8b8e-47f50363c0ef
title: Agent gets some tools by name only and opens the needed ones through tool_search
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/conversationSources.ts
  - kind: file
    ref: packages/agent/src/agent/AgentDeferredTools.ts
---
**Value.** An agent with a large tool catalog pays no context for schemas it does not use: it sees some of them by name only and opens them as needed.

**How.** The `tool_search` tool, which the agent gets when it has deferred tools; their names arrive in the run context.

**Behaviour.**
- A deferred tool's schema leaves for the model only after the search names it; it can be called from the next step.
- Search takes exact names or words; together with the tool its companions open — tools whose calls its answers print.
- An opened tool survives compaction. When the deferred set changes, the agent gets a new list.
- On a CLI that reads its tool list once per process (Muse Code), opening a tool never changes that list: the search answer itself carries the opened tool's schema, the agent calls it through `call_tool` with its name and input, and the first turn after the CLI compacts its own session hands those schemas over again.

**Limits.** Search answers with names and descriptions and carries no schema, except on a CLI that reads its tool list once.

Which tools are deferred is decided by the [[cad90fdf|agent definitions]]; their count is visible in the [[a267ca10|context ring]] and the [[905b4121|expensive-start card]].
