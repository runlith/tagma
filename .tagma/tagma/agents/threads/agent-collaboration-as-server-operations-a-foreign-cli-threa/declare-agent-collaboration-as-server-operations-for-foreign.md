---
id: 01a10482-8175-77c1-9919-b23539d67a59
title: Declare agent collaboration as server operations for foreign CLI threads
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10484-c5a1-73e4-949b-3433e0a4086a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10482-12cc-776a-a675-6349c478e2d3
---
Declare `send_message`, `send_task`, `interrupt_agent`, `spawn_agent`, `list_agents`, `stop_agent` and `continue_agent` as threads-module operations with `mcp`, `http` and `cli` doors. They share the same performer, `ThreadPlaneAccess`, with the caller thread by grant as sender. CLI wording in installs belongs here too. Model, boundaries and checks are all in the spec.

Start at: `packages/agent/src/collaboration/CollaborationTools.ts` (how runtime tools run), `ThreadSpawnTree.access`, the `threads/contract/wire/operations/*` catalog, `cli/mcpTools.ts`, `invocation/admission/identity.ts`.

Done when spec check items 1–5 pass, and item 6 is described as an operator step after the server restart.
