---
id: 01a0c830-ca7c-725c-8f17-dd5210359e4b
title: Cut packages/llm into its module and areas
ord: 69
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1a7a-7aaf-af23-9b19f654d022",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm
---
Wave 1, cutter: `packages/llm` (38,647 tracked non-test lines, 202 files) — the vendor model adapters, capture and transport the agent kernel speaks through. Depends on executions, ndjson-rpc, trace and utils (all built). The cutter writes the module, its boundary claims, the `depends-on` edges and the areas, and opens one build task per area under this decision.