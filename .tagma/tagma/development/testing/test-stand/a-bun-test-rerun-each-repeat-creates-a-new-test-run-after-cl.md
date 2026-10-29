---
id: 01a12371-eb92-7252-b218-4c0d38a0cb77
title: A bun test --rerun-each repeat creates a new test-run after cleaning the previous TMPDIR
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12374-0ea9-7931-b58a-f3113ea94071",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12367-4cd2-7fd4-b885-726eecf6da2b
sources:
  - kind: file
    ref: test/layers.ts
  - kind: file
    ref: test/residue.ts
---
`bun test --parallel=1 --rerun-each=5 ./src/notify/notify.itest.ts ./src/schedule/schedule.itest.ts --test-name-pattern 'a running server forgets|a run still standing after a day'` from `apps/tagma/server` on Bun 1.4.2: the first two scenarios pass, the other eight fail `NotFound: FileSystem.makeTempDirectoryScoped (/tmp/runlith-test/<run>/tagma-seeded-)`. `test/layers.ts` calls `openRun` once at preload, while each repeat's `afterAll` runs `run.verdict()`, which removes the root; TMPDIR stays pointed at the removed root. Fix the test-run lifecycle at the harness owner, keeping temp-file cleanup and process checks. Done when an integration-file repeat creates a working TMPDIR for every run and all five repeats pass with no processes or temp data left after finishing.

Result: preload keeps the initial run for file loading; after its close the next `beforeAll` opens a new root and re-scopes HOME, XDG and gitconfig. Closing restores the inherited TMPDIR and process marker, and budgets are counted separately for each repeat. The owner test checks fixture writing in the new root, removal of the previous one and of both roots after two repeats, plus keeping the parent marker. The defect was reproduced before the fix; after the fix five repeats of `platform/store/clock.itest.ts`, five harness tests and two repeats of a unit file passed. Strict typecheck of the three changed files passed; the leftover-process check is kept.
