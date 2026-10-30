---
id: 01a18d5f-6f9f-791b-a661-e0bf3bd6b3d6
title: "OpenCode moves into packages/adapter-opencode: terminal surface with its plugin, hosted client runner"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
---
Step 6 of the Migration in [[57787448]], one landing. Server code under `external-harnesses/vendors/opencode` and `runner/opencode` is deleted, tests move and stay green, behaviour and ids are unchanged.