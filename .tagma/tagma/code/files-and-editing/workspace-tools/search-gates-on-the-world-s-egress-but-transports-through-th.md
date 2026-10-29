---
id: 01a0ca9b-dd12-747b-b262-23a87057b7f2
title: Search gates on the world's egress but transports through the sessions pool's own fetch
ord: 25
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src`, `createWebsearchTool` refuses when the world binds no egress, but its bytes leave through the handed `WebSearchSessions` pool's own fetch (`WebSearchSessionsOptions.fetch`, default the runtime's) — the world's egress is never passed to `reach()` or `call()`, and nothing in this package wires it in. A world with a filtering or tracing egress therefore governs fetch and not search (gate at websearch.ts:137-138, pool bytes via `sessions.reach(endpoint)` at :119). Either thread the world's egress into the pool, or record the gate-only split as intended and pin it as a claim under [[97ae4de6]].