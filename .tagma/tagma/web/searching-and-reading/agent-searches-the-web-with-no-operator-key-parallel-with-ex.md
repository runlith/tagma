---
id: 01a14c08-1c3f-7bde-a2e3-0473addf19fb
title: "Agent searches the web with no operator key: Parallel, with Exa on failure"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0474f94d548e
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-047574109856
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/web.ts
  - kind: file
    ref: packages/agent-tools/src/websearch.ts
  - kind: file
    ref: packages/agent-tools/src/WebSearchSessions.ts
---
**Value.** The agent finds fresh information on the internet — docs, versions, errors — with no search-service key from the operator.

**How.** The `websearch` tool of the `web` capability (the built-in `tagma` agent holds it); with a Tagma web source — a deferred tool.

**Behaviour.**
- Search goes through the Parallel MCP server, with Exa on failure; a failed provider steps to the back of the queue for 5 minutes. The answer is markdown naming which provider answered.
- Search asks for no approval in any mode.

**Limits.** Both providers are external free services: their limits and availability decide whether search answers; both failing is a call error. When the model has provider web and `agent.web` is `vendor`, [[74109856|provider search]] runs instead of this tool.
