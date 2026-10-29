---
id: 01a14cc7-ddbf-77b9-871f-6de7db2bf84a
title: Moving a served project must not read its derived machine rows
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-6c7a-788b-a8e4-4b267db89c68",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/pool.ts
---
Moving a served project changes the registry's machine record and stores `project_set_root` in the machine journal with `projectId/from/to` in the payload and `null` in the block subject. The [[0a8e61b0|machine-registry-floor decision]] stands: `machineGraphOf` binds the lifecycle to the machine context, and `TreeGuard` judges real block writes. The bug was produced by `ProjectLifecycle.move` in `birth.ts`: it linked the registry event to the project root block whose machine rows were already retired after the move to files.

The defect predates the current native port of listing: pre-wave `92dcbd9511` holds the same producer and floor binding, and the old Promise `doorWorld` reproduced the same `project-retired` in execution `8d269feb-fc07-421a-a314-c36a68b9d9b0:167`. The event producer is fixed; the registry write and `ProjectChanges.changed` publication stay in the same transaction.

The existing `workspace/repositories/listing.stest.ts`, run as one file with `--parallel=1`: red `28550810-be4f-42e3-8253-c4dedf227e89:167` — 8 pass / 1 fail (`project-retired`); green `de653fb9-1c82-4459-a931-0f7be2417eba:167` — 9 pass / 0 fail, 38 assertions, 8.05 s. The scenario is extended with new-root and machine-journal-record checks; after coverage revocation the earlier prepared worktree still gets `RepositoryMissing`. `bun check --threads=1`: producer — 418 files / 0 errors (`ba2825b4-651e-47d6-b50b-91fd97b263fa:167`), producer with consumer closure — 3498 / 0 (`296d1c1a-2f55-46e3-b67c-2424adbd5e81:167`). These are results on the shared moving checkout, within the named scenario and closure.

The [[01a14ccd-1a40-76ee-87e3-d41d729dfa57|single independent reviewer]] on `openai-oauth/gpt-6.1-sol/xhigh` read the whole zone and sources, confirmed the registry boundary, and returned 0 findings; the author's checks are reused. Commit `7cf46e8807533cf4f8ee86e77c93445eebc6e5c73` holds the producer fix and the added assertions. The consumer file's native-fixture rows belong to the composition owner and remain its change.
