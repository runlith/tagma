---
id: 01a0c6f6-d55f-76ed-b862-1e8ab17f0065
title: Build the zone for packages/package-boundary
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6f7-80ae-7d1d-8e89-5404b682d9a5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/package-boundary
---
Wave 0, builder alone: `packages/package-boundary` (747 lines) — the walk that measures every other package's boundary, so its claims are what `dependency-undeclared` and the boundary suites rest on.