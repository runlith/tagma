---
id: 01a18a51-284d-7f34-b786-fc00f111a4d7
title: A root-registry reopen test using sharedPool leaves two SQLite children
ord: 1224
tags: ["reflection"]
fields:
  {
    "actual": "The replacement contract passed 8 assertions, but testbed teardown failed after 8.3s and killed two sqlite-process child.ts processes attributed to this file.",
    "command": "../../../node_modules/.bin/testbed bun test --no-isolate ./src/workspace/roots/registry.itest.ts --test-name-pattern 'replacement is durable'",
    "expected": "The selected registry contract passes and its file leaves no child processes after using the shared in-process SQLite pool."
  }
---
Filed from project `tagma`.

Report /tmp/runlith-test/reports/run.16327.1793321902495.jsonl. Spawn chains: childHosting -> ProcessPool.spawn -> connect, and childHosting -> ProcessPool.spawn -> connect -> Checkpoints.add. The test at registry.itest.ts:319 supplies sharedPool to storeLayer. Concurrent ProcessPool/store-hosting changes are in progress; this observation does not identify which construction omitted the selected pool.