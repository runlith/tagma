---
id: 01a0de23-8f00-72fe-b64b-8729b7d0a179
title: Expose retained command bytes to agents and name the recovery read in bash
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de21-0a2f-715b-baab-a495f06a4195",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c4eb-6321-786a-a7b4-92ae78b567fd
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/operations/commandCatalog.ts
  - kind: file
    ref: packages/agent-tools/src/bash
---
Make the existing command-byte owner readable by a native/MCP operation without confusing bounded commands with terminals; keep the project's command authority and record-offset semantics. Name the already-offered operation-key read in uncertain bash answers. Completion: exercise a completed background command's stdout/stderr through the new door, prove an operation key's independent lifecycle read, run contract tests and typecheck, and reconcile touched claims.