---
id: 01a13299-7008-7e1f-99b0-2ccdc35cdcce
title: Inventory and rename of graph operations and refusal codes by contract, in one change with grant migration
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13292-a115-76da-af84-5bdbc3ad3db4
  - kind: waits-on
    to: 01a13299-7008-7e1f-99b0-2ccb2f000c78
  - kind: waits-on
    to: 01a13299-7008-7e1f-99b0-2ccc8d21b871
  - kind: waits-on
    to: 01a132bf-ca54-75da-a35f-23e2721374ce
sources:
  - kind: file
    ref: .agents/skills/tagma/OPERATIONS.md
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlocksRepo.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/StatusMenuItems.svelte
  - kind: file
    ref: apps/tagma/server/drizzle/20261013021000_graph_operation_names/migration.sql
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/operationCatalog.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/batch.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/reads.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/work.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/operationContexts.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/operationNames.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/renamedOperations.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/rules/identity.ts
---
Build [[c3ad3db4]] last, after all other tasks of the spec [[229fd769]]. Start with the inventory. Inventory: [[31dbed79|74 operations, batch verbs, and 166 refusals]]. Verified: 49 narrow contract tests, app typecheck/svelte-check, diff and search for old names in live code. Overall server typecheck stays red only on 17 errors in four pre-existing capture/provider tests outside the change. One review round (Sol xhigh and two Muse xhigh lenses) is done; the missed translation of restored contextChange.evidence.tools and the batch description are fixed. The live server was not changed.
