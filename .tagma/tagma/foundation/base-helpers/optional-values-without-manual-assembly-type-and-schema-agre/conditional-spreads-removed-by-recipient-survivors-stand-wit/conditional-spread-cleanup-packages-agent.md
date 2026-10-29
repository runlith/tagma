---
id: 01a12812-89b3-78cf-8d61-fdf362815ff8
title: "Conditional spread cleanup: packages/agent"
ord: 1
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
    ref: packages/agent
---
The [[40ffd688|spec]] step-4 procedure is done over `packages/agent`: of 591 sites found, 580 removed, including three `pickDefined` and the facet-name check via `optionalKey`. 11 conditional spreads remain with patch owners and key counting: `ModelRequests.ts`, `modelChoice.ts`, `storage/memory/ThreadRuns.ts`, `transition/kernel.ts`; reasons and exact sites are recorded in the executor's report. Public types were not widened; the test helper accepts `AgentToolInvocation`. Typecheck, 1468 unit tests, and 101 integration tests are green. Changes stand in `b8cd90a7a4`, `0bdbe8a74f`, `88a5a27ea5`, `9550d40bb6`; the wave coordinator runs the shared review.
