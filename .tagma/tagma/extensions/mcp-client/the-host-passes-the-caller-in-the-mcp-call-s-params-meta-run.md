---
id: 01a11922-07b0-7d63-9543-6f6840c899dc
title: The host passes the caller in the MCP call's params._meta["runlith/caller"]
ord: 18
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/mcp/src/mcpCallerMeta.ts
---
When the host passed a caller, `params._meta["runlith/caller"]` tells the MCP process the initiator and the `tools/call` project, so one process can serve several projects. This is attribution, not authentication: the process trusts the host filling in the caller.

The agent `ToolCaller` maps to the `agent` variant; `thread: null` keeps an agent launch with no thread. The operator and host events pass the `operator` and `tagma` variants. Sessions are not split by initiator. `ping` and `tools/list` carry no caller; tool input does not set one.
