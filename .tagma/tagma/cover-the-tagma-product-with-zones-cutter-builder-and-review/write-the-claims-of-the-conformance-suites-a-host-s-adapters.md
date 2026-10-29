---
id: 01a0c946-84be-75a7-afab-772b3a8523ad
title: Write the claims of the conformance suites a host's adapters must pass
ord: 147
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c948-6027-709e-916c-1cfbb74c0bd6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/agent/src/thread/conformance
  - kind: file
    ref: packages/agent/src/workflow/conformance.ts
---
Read `packages/agent/src/thread/conformance/` and `packages/agent/src/workflow/conformance.ts` whole — six files, about 7,500 tracked lines, 134 registered test titles. None of them is a test file by name: each suite registers only when a host invokes it with its own factory.

Fill [[c719285e]]. The ports these suites prove are [[c765e6ba]] and [[5501ab0b]]; state what each suite obliges a filling to do, not what the port declares. [[9d5d962d]] already states that two doors load `bun:test` — do not restate it. `ScriptedCrossing` is exported from `runLog.ts` with no importer anywhere. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.