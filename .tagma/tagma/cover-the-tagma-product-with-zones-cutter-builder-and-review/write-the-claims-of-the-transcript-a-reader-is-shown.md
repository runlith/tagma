---
id: 01a0c946-844b-70c8-bdb4-a916513097ef
title: Write the claims of the transcript a reader is shown
ord: 136
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
    ref: packages/agent/src/transcript
---
Read `packages/agent/src/transcript/` whole — thirteen files including three tests.

Fill [[b379a5a0]]. Its wire twin is [[757d9a82]] and its producer is [[408c5fc6]]: relate rather than duplicate. `attachments.ts` already carries a claim of the llm zone ([[1069b21f]]) about the shared source-byte ceiling — read it and do not contradict it. Several exports are reachable only by relative import and not through the barrel (`threadLife`, `ThreadTranscriptView`, `PageWalk`, `ThreadSignalPart`, `ThreadCompactionReceipt`, `ThreadContextChangeEntry`): check whether that is a boundary worth a claim. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.