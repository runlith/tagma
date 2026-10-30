---
id: 01a18d5f-6f42-72f4-a04e-6d5e29b14a0e
title: "Cursor moves into packages/adapter-cursor: terminal surface, hosted SDK runner with its --ask entry, hook codec"
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
---
Step 6 of the Migration in [[57787448]], one landing. Server code under `external-harnesses/vendors/cursor` and `runner/cursor` is deleted, tests move and stay green, behaviour and ids are unchanged; the runner ships only in this builtin package.