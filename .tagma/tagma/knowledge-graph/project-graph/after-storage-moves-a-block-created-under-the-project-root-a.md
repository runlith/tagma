---
id: 01a1b28e-3e68-7f3f-bf1d-0399ece59016
title: After storage moves, a block created under the project root answers that the root is in the trash
ord: 20
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/storageCommits.itest.ts
---
In Linux integration run 42287322763 (commit 30d75a6e1, job 128131465705) `storageCommits.itest.ts` — "storage moves commit checkout additions and removals only under the automatic graph policy" — failed at line 75: after the project moved team → stealth → team twice under `manual` and `off`, back to `auto`, then to stealth, and a `MERGE_HEAD` was written into the hidden graph's tree, `create_block` under the project's root answered 409 `deleted` — "block 9a8fc90d is in the trash" — instead of 200. The root itself was created by the project and never deleted by the test. The test passed in every earlier CI run, so the outcome depends on timing: find which owner moves the root into the trash during a storage move (a deletion the watcher or the move recorded while the root's file stood in neither storage) and make the move never leave a standing block trashed. Locally six parallel runs pass. The refusal reads `deletedAt` on the root's mirror row (graph/acts/rows.ts:89); besides explicit trash acts and graph steps, the only writer of `deletedAt` is mirror repair trashing a path it holds as `gone` (graph/tree/mirror.ts:503), so the stealth copy's repair most likely took the root's file for gone. 8b2e5c3fe fixed one real way to that state — repair trusted a git `D` without reading the file, and a test proves a block whose file stands no longer goes to the trash — but that this was the runner's path is unproven until the test runs green there again. Earlier unverified lead: the trash suggests a block-file deletion was read as the block's removal — a watcher event of the tree the move emptied, delivered late on the loaded runner, would do it; the move itself is exclusive per project (pool.ts `moveProjectStorage` through `servingSwitch.move`).