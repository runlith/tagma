---
id: 01a0e087-9011-7b11-82db-d0f24295ace3
title: Writer timings belong to the transaction that ran them, and write_setting over REST runs write_setting (findings F004, F008)
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e087-c56e-7f09-9203-c9d87bad9f88",
    "status": "done"
  }
---
From the architecture findings register (`spec-findings.md`).

- **F004.** `db/Store.ts#WriterTimings:298-327` keeps one stack per Store and `note` writes into every frame; `#storeTransaction:358-360` pushes a frame before taking the writer. With A running and B waiting, A's statements are counted in B, so the over-budget diagnostics (8.9 s waits, [[c6c8ba34]] S5, task [[66fb4c59]]) can blame the wrong holder. Contradicts claim [[291cc685]]. Fix: timings scoped to the owning transaction; wait time separate from execution.
- **F008.** `api/operations.ts#HTTP_OPERATIONS` maps `write_setting` to `settings.write`, but `http/handlers/settings.ts:52-62` calls only `write_setting_layer`. Fix: the REST road of `write_setting` runs `write_setting`.

Done when: a test shows two concurrent transactions each report only their own statements (fails before), a test pins the REST call to the right body, claims reconciled, commit names this task.