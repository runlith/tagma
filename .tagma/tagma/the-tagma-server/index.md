---
id: 01a0ca94-63c5-789a-9e91-c36105042d40
title: The Tagma server
ord: 22
tags: ["module"]
fields:
  {
    "kind": "product"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
Tagma keeps a project's knowledge in one graph, and this package is where the graph lives and where everything working it runs: blocks and the law over them, measurement, session orientation, agent threads, checkouts and their work hosts. Everything non-Tagma — the agent runtime, model wire, git, the execution host, the MCP client — arrives as workspace packages whose ports it fills, and it serves release programs without importing them. Outward go only the dictionary and door declarations: the app assembles against the door, not the code behind it.
