---
id: 01a0ca97-13af-7f9e-a73b-6bb40f5b0103
title: Write the claims of the composition a Tagma thread runs in
ord: 205
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caa9-214e-7719-94b8-0cee01c33ff4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/resources/kinds
  - kind: file
    ref: apps/tagma/server/src/composition/serving.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/rhythm.ts
---
Read `harness/Stack.ts` whole, with `owners.ts`, `rhythm.ts`, `AccountDefaults.ts`, `chosenModel.ts`, `turnContext.ts`, `observeStepQuota.ts`, `capturedHooks.ts`, `captureDriver.ts`, `worldState.ts`, `facetGate.ts`, `instructionDelivery.ts`, `compactionPolicy.ts`, `threadGraphs.ts`, `resources/`, and the four workflow files.

Write the claims of [[70db8905]], [[3ded8caa]] and [[73faac5e]]: which of the kernel's ports this product fills and with what, which figures this composition states that the kernel leaves to its host, what a thread HOLDS while it exists and what releasing it does, and what a workflow of this installation may name. The kernel's own account of those ports is [[c765e6ba]] — read it and write what Tagma decides, not what the kernel already states.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].