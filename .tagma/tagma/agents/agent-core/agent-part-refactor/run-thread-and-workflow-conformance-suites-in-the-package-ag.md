---
id: 01a11901-5360-733e-9ca2-911ed3c0852f
title: Run thread and workflow conformance suites in the package against InMemory, cut runLog, storagePort, compactionRequests by subject
ord: 16
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2ccb523c3230
---
Implements [[523c3230]]. Start with `packages/workflow/memory.test.ts` as the runner model and `packages/agent/src/thread/conformance/`. Done when every conformance contract runs in the package and in Tagma, the three files are below 650 lines and their debt is gone, and typecheck plus the affected suites are green.
