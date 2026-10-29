---
id: 01a11901-5360-733e-9ca2-912018df4b16
title: ToolCaller in every tool call, thread bindings at birth, _meta in MCP
ord: 18
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2ccdb771b4db
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911ed3c0852f
---
Implements [[b771b4db]]. Start with `packages/agent/src/agent/tool.ts`, `AgentToolDoor.ts`, `packages/mcp/src/mcpToolCatalog.ts`, `sdk.ts:281`, the Tagma `native-harness/tools/mcpServers.ts`. Done per the spec criteria, including the wire-request test with `params._meta`.
