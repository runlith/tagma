---
id: 01a18d5f-6f01-75b8-81ef-003b8cc83f67
title: "Codex moves into packages/adapter-openai: terminal surface, hook codec, rollout reader, app-server root and cut"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ae-2d0b-74f2-91fc-f0e9ba085af5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: waits-on
    to: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
---
Step 6 of the Migration in [[57787448]], one landing. Server code under `external-harnesses/vendors/codex` is deleted, tests move and stay green, behaviour and ids are unchanged.