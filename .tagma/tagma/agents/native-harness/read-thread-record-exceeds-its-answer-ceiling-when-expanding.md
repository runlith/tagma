---
id: 01a188a0-19e3-7340-9681-85485b7617f2
title: read_thread_record exceeds its answer ceiling when expanding an activity body
ord: 61
tags: ["reflection"]
fields:
  {
    "actual": "The activity-body regression failed at evidence.itest.ts:1209: expected <= 51200 bytes, received 51330; 52 other affected tests passed.",
    "command": "/Users/teunlao/runlith/tagma/node_modules/.bin/testbed bun test --no-isolate --randomize --seed=1 ./src/composition/testing/native-harness/activityWindow.itest.ts ./src/composition/testing/native-harness/evidence.itest.ts ./src/composition/testing/threads/listStore.itest.ts ./src/composition/testing/threads/listWindow.itest.ts",
    "expected": "The existing public-door activity-body regression returns at most 51,200 encoded bytes per expansion response."
  }
---
Filed from project `tagma`.

The failure is in the unchanged activity-body expansion branch, independent of the thread-list selection change. The full result is in execution 6f0b43d8-e3f2-4a62-8cca-168c668ba7d0:167.