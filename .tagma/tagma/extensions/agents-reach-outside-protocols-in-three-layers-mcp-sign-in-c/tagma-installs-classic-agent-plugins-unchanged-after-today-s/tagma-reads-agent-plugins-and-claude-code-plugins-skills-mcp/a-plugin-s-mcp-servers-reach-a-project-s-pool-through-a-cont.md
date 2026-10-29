---
id: 01a18906-5946-7cc1-afe1-26abe2da2198
title: A plugin's MCP servers reach a project's pool through a contributed-declarations port of mcp
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188fc-d38e-7d33-8293-8d062c7a0809",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e663966472
  - kind: waits-on
    to: 01a18906-5946-7cc1-afe1-26aa0308018b
---
`mcp` declares the port, the plugins module fills it from the plugins enabled in the project. A user or project declaration of the same name shadows a contributed one; disabling one is a project setting keyed by its name; a contributed declaration is never expanded from Tagma's environment.