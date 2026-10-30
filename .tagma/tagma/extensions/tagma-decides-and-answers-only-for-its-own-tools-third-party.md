---
id: 01a1511d-dca1-74d7-be94-9acf7a4ff805
title: Tagma decides and answers only for its own tools; third-party behavior — MCP, plugins, vendor tools — it does not override
ord: 55
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: packages/mcp
  - kind: dir
    ref: apps/tagma/server/src/mcp
  - kind: dir
    ref: apps/tagma/server/src/plugins
  - kind: dir
    ref: packages/agent/src/agent/door
---
Order, parallelism, defaults, and workarounds for third-party problems are built only for Tagma tools and operations. A third-party tool runs as its author declared it.
