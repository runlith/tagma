---
id: 01a18a53-aa07-73a9-939d-4fc6170dbe11
title: Native graph file checks leave one SQLite child despite passing every body
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "All 14 test bodies and 93 assertions passed, but afterAll killed one sqlite-process child.ts (PID 22126), leaving the command exit 1 after 9.8 seconds.",
    "command": "bun run testbed bun test --no-isolate ./src/composition/testing/native-harness/graphFiles.itest.ts --randomize --seed=2",
    "expected": "All native graph contracts pass and the file leaves no child process at testbed teardown."
  }
---
Filed from project `tagma`.

Report /tmp/runlith-test/reports/run.22106.1793322013396.jsonl; spawn chain childHosting -> ProcessPool.spawn -> connect. The preceding seeds of this file spawned no SQLite children; final seed 3 also passed 14/14 with sqlite 0. Concurrent SQLite hosting changes were in progress, so this sighting does not identify the omitted pool construction. The standing root-cause task is already held.