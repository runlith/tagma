---
id: 01a18a56-f2e5-7912-8151-4bcefa274283
title: The same SQLite-child teardown leak reaches the thread archival fixture
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "Seed1 passed; seed2 passed all20 tests but failed teardown after8.1s and killed4 child.ts processes, including tagma.sqlite and the global-project mirror; seed3 did not start.",
    "command": "../../../node_modules/.bin/testbed bun test --no-isolate --randomize --seed=1 ./src/composition/testing/threads/threadArchive.itest.ts && ../../../node_modules/.bin/testbed bun test --no-isolate --randomize --seed=2 ./src/composition/testing/threads/threadArchive.itest.ts && ../../../node_modules/.bin/testbed bun test --no-isolate --randomize --seed=3 ./src/composition/testing/threads/threadArchive.itest.ts",
    "expected": "Each changed file seed completes without SQLite children outliving its shared door-world fixture."
  }
---
Filed from project `tagma`.

Report /tmp/runlith-test/reports/run.33634.1793322281869.jsonl. Retained output /Users/teunlao/.tagma-dev/executions/01a083b0-37bd-7a58-9ba1-be2b7b69a2e8/records/38303565373263642d613131622d346635662d383166322d323837376433613135653931/output.log. The same file's preceding three-seed run was green before ongoing pool-hosting changes. The active half-born deletion itself passed in this failed file; that does not make the file green.