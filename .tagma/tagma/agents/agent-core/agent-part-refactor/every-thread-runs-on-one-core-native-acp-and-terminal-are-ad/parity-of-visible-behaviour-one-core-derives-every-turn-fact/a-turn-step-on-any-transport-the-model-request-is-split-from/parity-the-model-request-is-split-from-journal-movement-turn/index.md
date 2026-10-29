---
id: 01a14cf8-61ad-7951-8d02-f76495efcfc2
title: "Parity: the model request is split from journal movement; turn phase and per-request spend live with one core owner"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01c7-7c57-8276-9b8a4d9df8f3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-6080424c0878
---
Implement [[424c0878]] in full: `recorded`/`measured`/`retried` reports instead of `step`, `landRequest`, `RunProgress` with a durable phase and `estimate`, the runner's phase state machine, the run cost `thread_run.cost`, composition estimate with a `rest` segment, the start card from the first request, the `process` waiting reason in the app. Proof — the acceptance criteria of the part and its scenarios in the parity suite, commit.

Done in ce63e64f47, afeccf470e, 477666c38b (agent part — in c6d5e8699b). Proven: `RunProgress.test` (estimate survives a phase change, phase reaches the row through a tick), the runner contract (`$/tagma/phase` by table, spend remainder and the negative field in `spend.test`), transport conformance on memory and SQLite (`measured` is idempotent, `ended` writes remainder and cost), protocol stest (a request is spent at once), live `protocolClaude.stest` (cost with `basis` in `thread_run.cost`), cost migration — a trial on a schema copy.

The parity suite (081b287102, `parity.stest.ts`, "a request reads the same on native and ACP", native versus scripted `acp`) proves: one turn-phase sequence "reasoning → text" and the held phase from the run row; `opening` with the `process` reason and the same `since` across a server crash (only `acp`: native has no agent process); the first request's spend on the run, the opening composition estimate, and the start card; `stepNumber` 0 and 1 with each request's spend across a server crash between requests, with no double count of the repeated `usage_update`. The scenarios found a defect: adopting a run wiped its phase (`adoptRun` rewrote `progress` wholesale) — fixed in 6e54b83f77. Not proven: `since` on a fake clock in the middle of long reasoning; late turn spend arriving after the turn ends is lost — [[0aee0af9]].
