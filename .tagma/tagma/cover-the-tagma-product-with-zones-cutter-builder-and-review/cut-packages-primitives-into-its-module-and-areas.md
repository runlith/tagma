---
id: 01a0c830-ca8f-7764-b78a-4d84c809e417
title: Cut packages/primitives into its module and areas
ord: 71
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1bc9-78e9-94d9-eea625d11081",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/primitives
---
Wave 1, cutter: `packages/primitives` (4,326 tracked non-test lines, 46 files) — the UI primitives the app and chat-ui stand on. Depends on error-boundary and layer (both built); `testing` is reached from its suites alone and is no edge. The cutter writes the module, its boundary claims, the `depends-on` edges and the areas, and opens one build task per area under this decision.