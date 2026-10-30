---
id: 01a18a44-d114-7536-8521-4951015b7e44
title: Restore an MCP run snapshot after its server reconnects
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-ddfb-7d40-866b-4b396cc09849",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a14c38-51a1-79f0-a6e6-0a6d3c8bfdcd
  - kind: discovered-from
    to: 01a15063-6fba-7825-b987-3cf539796dd6
---
Keep the run's original MCP tool membership while rebuilding its available subset when the project pool's catalog changes; prove disconnect and reconnect through the same running harness, without offering newly added servers or tool names. Propagate the producer's catalog revision through McpServers and the native capability, then verify restored context, search and execution.