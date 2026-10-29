---
id: 01a12812-89b3-78cf-8d61-fdf7ece95215
title: "Conditional spread cleanup: llm, mcp, agent-tools"
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
sources:
  - kind: dir
    ref: packages/agent-tools
  - kind: dir
    ref: packages/llm
  - kind: dir
    ref: packages/mcp
---
The [[40ffd688|spec]] step-4 procedure over `packages/llm`, `packages/mcp`, `packages/agent-tools` — about 350 sites. A vendor request body where the SDK or the wire distinguishes key presence is a permission. Done when the `optional-spread` inspection over these areas finds only recorded needed sites, and typecheck and tests are green.
