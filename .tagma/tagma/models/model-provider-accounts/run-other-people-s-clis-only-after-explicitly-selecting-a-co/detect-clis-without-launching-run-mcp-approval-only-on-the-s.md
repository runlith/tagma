---
id: 01a164c3-5250-7156-b436-74d29aae495d
title: Detect CLIs without launching; run MCP approval only on the selected road
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164c3-cd5f-7fa5-bf90-6f078f03e37e",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf09-7bd4-86c2-a17f287a4906
---
Remove two passive external-harnesses launches: the shared InstalledHarnesses.read/settled/refresh and homes startup stop launching --version, and startup MCP declaration stops calling cursor-agent mcp enable. An addressed real launch checks its binary and performs the needed approval; every CLI keeps that road. Proven by public discovery/install/start contracts with no real user CLI.
