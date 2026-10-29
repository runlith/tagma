---
id: 01a1271e-2479-7971-9b0c-4ecf93ba9131
title: Remove the first-enablement road
ord: 10
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/recovery.ts
---
A separate landing in main after [[7c1b6811]], once the operator's machine has passed first enablement: its host state catalog holds a holder (this reads without touching anything). Remove the holderless host road and everything that serves only it (`executions/host/recovery.ts` in that role). Proven: the code holds no road to a host without a holder; host and server tests pass.
