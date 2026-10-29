---
id: 01a13fd9-f91d-7923-89d2-6a4ca8735d64
title: Migrate the storage conformance API and all consumers to Effect
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523d-71cd-acb6-4295df9398b1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33ab8c71aa1b
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/storageHarness.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/storagePort.ts
---
ThreadStorageHarness/Factory in packages/agent/src/thread/conformance/storagePort.ts, the implementations (including in-memory), composition/testing/storageHarness.ts and all storage call sites migrate to Effect in one delivery: factory and reopen require the test owner Scope, createThread returns a typed Effect, dispose an Effect<void>, operations context-free after make. Remove hidden runners and ManagedRuntime; keep faceted scope, restart and conformance contracts. Verification is the touched packages' typecheck, serial conformance tests and effect-style 0; after landing, unblock the scriptedWorld migration at port-agent-tests.
