---
id: 01a0c946-849a-74bb-a6e3-6415f1d4f77f
title: Finish the compaction zone against its code and put it in the graph's own language
ord: 143
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
    ref: packages/agent/src/thread/compaction
---
[[8faf533f]] was written before this module existed and now hangs under [[c3e78736]]. It holds three verified claims, all about the trigger; the directory is about 2,900 tracked lines — the prefix selection, the digest and summary strategies, the pruning, the overflow handling, the measurement, the calibration and the shipped corpus are unclaimed.

Read `packages/agent/src/thread/compaction/` whole, including `corpus/`. Revise the area rather than recreating it: its body is written in Russian while every other container in this graph is in English, so rewrite it in English as part of the revision, keeping what the code still supports and dropping what it does not. Then write the missing claims. The trigger claims [[2e2b7cf9]], [[dc161b9d]] and [[96149ce8]] are already verified — re-read their sources before building on them, and correct rather than duplicate.

The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.