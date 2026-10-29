---
id: 01a0f4ab-e2e3-7f9d-891d-df638dc37737
title: Delete the four builtins no rule carries, the `tagma` pack and their `checks/` copies, and make `platforms.built` a parameter list
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f4ac-8757-796f-9b8a-44e118189ede",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
---
Delete the four builtins no rule carries — `held-resources`, `blocking-calls`, `answer-declared`, `operations-registered` — with the `tagma` pack, their `checks/*.server.json` and `checks/*.server.debt.json` copies and the `bench:*` scripts that read them, and make `platforms.built` a parameter list ([[cdf2a89f]] §4.1; M4, M5 of [[9140c692]]). No law in force changes: no enforced rule carries them.

**Class:** simple — `claude-sonnet-5-5` high.

**File scope:** `apps/tagma/inspection/src/packs/tagma/**`, `packs/effect/held-resources/**`, `packs/typescript/blocking-calls/**`, the manifests and `implementations.ts` of `effect`, `typescript`, `tagma`; `src/builtins.ts`, `src/builtins.node.ts`; `apps/tagma/inspection/package.json` scripts; tests naming them (`src/vocabCalibration.test.ts`, `src/core/node/budget.test.ts`); `packs/typescript/platforms/declaration.ts` and its test; `checks/{answer-declared,blocking-calls,held-resources,operations-registered}.server{,.debt}.json`. `call-services` imports `inRegion` from `held-resources/declaration.ts`: move it to the file that owns the shared parameter helpers (`src/core/params.ts`). Not `apps/tagma/server/src/graph/contract/wire/enforcement.ts` (the codec task).

**Acceptance:**
- `read_inspections` answers 8 builtins and the packs `typescript`, `effect`, `repository`.
- `platforms.built` is a list of package names; [[50520d64]]'s document decodes; its `tightens` for `built` is unchanged (`within`).
- `check_rules over: all` reports the same violations for every enforced rule before and after (record both counts in the task's close).
- Typecheck of `@tagma/inspection` and the server; `bun --cwd apps/tagma/inspection test`.

**Reviewers:** one Muse lens (nothing still reads what was deleted).
