---
id: 01a0de46-c9ae-7450-8a4c-5ffb0c31b593
title: Keep contiguous standalone prose comments whole when a write strips one of their lines
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de3e-3fc8-76d3-ba48-b9ea9b1941a1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c71b-994a-7031-9243-634807f4d074
sources:
  - kind: file
    ref: packages/source-comments/src/index.ts
---
An edit that changes one line of an existing prose sentence can leave its untouched continuation hanging. Make the source-comment strip treat adjacent standalone prose lines as one run while preserving directives and prose separated by code or a blank line; verify the source contract and a real edit door, then reconcile the affected claims.