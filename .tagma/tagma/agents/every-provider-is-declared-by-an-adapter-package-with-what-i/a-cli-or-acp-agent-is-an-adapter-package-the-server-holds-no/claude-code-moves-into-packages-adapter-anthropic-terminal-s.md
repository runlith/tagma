---
id: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
title: "Claude Code moves into packages/adapter-anthropic: terminal surface, hosted runner, hook codec, metadata reader"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d5f-d1a2-7ec4-8e80-38ffb97302f1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-315e-7cf6-89b8-16def116d3cd
---
Step 5 of the Migration in [[57787448]]. The ask program already lives in the package (part 1). Its server code under `external-harnesses/vendors/claude-code` and `runner/claude-code` is deleted, tests move and stay green, behaviour and ids are unchanged; the hosted runner ships only in this builtin package.