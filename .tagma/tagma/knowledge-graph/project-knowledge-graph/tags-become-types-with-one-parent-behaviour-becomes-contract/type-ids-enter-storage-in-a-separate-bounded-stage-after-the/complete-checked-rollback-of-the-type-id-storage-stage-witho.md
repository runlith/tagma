---
id: 01a0f576-b1cc-754f-87d7-2169ed94c13b
title: Complete checked rollback of the type-id storage stage without changing canonical graph data
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f54e-5a74-745f-a9a0-cfbad7290948",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46d2-76de-8852-1252b4f28f40
---
Complete the checked reverse migration left open by the type-id storage stage, within the rollback contract of [[516d96bd]]. The storage owner must establish the supported previous binary/schema boundary and provide the owner's migration road, preserving nodes, immutable keys, history, verdicts and enforcement documents. A failed backfill rollback or an old binary's MigrationChainInvalid refusal is not this acceptance. Read current storage and migration ownership, implement the missing path without restoring a snapshot or mutating the live store, and prove it on an isolated old-store → current → supported previous-schema scenario. Refuse reversals that cannot preserve data. Executor: tag-storage; claims through Muse, task lifecycle by executor.