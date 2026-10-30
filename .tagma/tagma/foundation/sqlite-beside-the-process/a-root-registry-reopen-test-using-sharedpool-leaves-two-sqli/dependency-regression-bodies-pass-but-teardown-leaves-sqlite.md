---
id: 01a18a55-43de-71d0-9f65-e2d19f926992
title: Dependency regression bodies pass but teardown leaves SQLite children
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "Both bodies passed (32 and 4 assertions), but teardown killed one mirror child for nativeBindings and three db.sqlite children for submitDependencyFiles, failing each run after about 8 seconds of cleanup.",
    "command": "../../../node_modules/.bin/testbed bun test --no-isolate ./src/composition/testing/landing/nativeBindings.itest.ts -t 'dependency patches' --randomize --seed=2; ../../../node_modules/.bin/testbed bun test --no-isolate ./src/composition/testing/landing/submitDependencyFiles.itest.ts --randomize --seed=2",
    "expected": "The native and owner-level dependency contract scenarios pass and release their SQLite processes with their fixtures."
  }
---
Filed from project `tagma`.

Reports /tmp/runlith-test/reports/run.27667.1793322127830.jsonl and /tmp/runlith-test/reports/run.29525.1793322174623.jsonl. Native residual PID28067 held home/mirror/2/8bf35a348457ad55.sqlite; owner-fixture PIDs29561/29566/29567 all held /private/tmp/runlith-test/29526.w1/db.sqlite. All spawn chains were childHosting -> ProcessPool.spawn -> connect. No dependency assertion failed. Sent to reflection-record for the already-running SQLite lifetime track; the dependency production change did not touch pools or their lifetimes.