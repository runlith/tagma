---
id: 01a18916-9cf0-77f5-9f68-5c7585cc8a79
title: Closing several app and MCP stdio processes waits their grace together, not one after another
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18903-02e6-7cf3-a738-01f7a592aa92",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e89b246531
sources:
  - kind: file
    ref: packages/mcp/src/McpPool.ts
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/supervisor.ts
---
Of the installed apps, only one (an app exiting from `onclose` alone; SDK `StdioServerTransport` never fires it on stdin EOF) outlives stdin and pays the stdio grace; the rest exit within milliseconds. The grace still added up because app generations and pool sessions closed in sequential scopes. Close them in parallel scopes, keep the per-transport grace and SIGTERM for every server, and tell app authors in the `apps` skill to exit on stdin `end` themselves.