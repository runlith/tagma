---
id: 01a1515d-d83a-7a7b-bc92-94c0b5bac326
title: A release no longer requires folding graph steps and journal shapes already carried by the previous release
ord: 140
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-447e-74fe-864e-df6f5d7eb77a",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/pipeline.ts
---
Cut admits graph steps and journal shapes carried by the previous release: they stay in the stored-shapes accounting, while the demands to delete them and to base on the latest release are removed. Step code in `graph/steps/` and shape application unchanged. Deletion assignments removed in the linked specs and the old task before the first release too.

`machine-store` migrations keep the old check folding carried migrations, except the basemost one from receipt: the task cancels folding of carried graph and journal shapes, not a separate ledger fold of the machine base. Migrations and baseline not rewritten by this work; `host-store` stays outside the fold check.

Checks: a new contract of the existing pipeline test — red → green; 46 unit/integration cut checks green with a narrow rerun of the fixed `release.itest.ts`. Its synthetic checkout supplemented with the producer-missed watch artifact, over which four tests previously refused on `program` instead of their own step. `git diff --check` passed. `bun run typecheck` from server ended `Found 16 errors in 6 files, checked 5,095 files`: errors in other agents' `enforcement/CommitQueueRecovery.itest.ts`, `enforcement/commits/queue.ts`, `enforcement/rules/measureBound.ts`, `graph/operations/work.ts`, `graph/work/proposals/conflicts.ts`, and `listing.ts`; full typecheck stays unproven. Server not restarted, real cut and `tagma:release` commands not run.
