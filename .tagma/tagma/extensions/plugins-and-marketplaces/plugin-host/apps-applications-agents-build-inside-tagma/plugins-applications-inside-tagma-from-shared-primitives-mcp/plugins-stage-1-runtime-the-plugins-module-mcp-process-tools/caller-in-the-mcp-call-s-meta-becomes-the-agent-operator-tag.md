---
id: 01a12306-efba-7a0e-94d7-05edec9d1962
title: Caller in the MCP call's _meta becomes the agent | operator | tagma tagged union with a shared projectId
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-3159-7f2d-8ade-63fca1c982ab",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: packages/mcp/src/mcpCallerMeta.ts
---
The spec's “Caller” section. The union is the wire type `mcpCallerMeta` owned by `packages/mcp`; the agent's `ToolCaller` (`packages/agent/src/agent/contracts.ts`) is unchanged and maps to the `agent` variant, `thread: null` for a threadless `AgentRunner`.

Done when the test shows the three different union variants in `_meta` reaching the MCP server from an agent's call, an operator's call, and a Tagma event.
