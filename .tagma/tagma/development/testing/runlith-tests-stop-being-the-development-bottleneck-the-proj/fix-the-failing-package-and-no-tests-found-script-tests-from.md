---
id: 01a16bd0-d75c-7f7b-88af-5c9234c2f965
title: Fix the failing package and No-tests-found script tests from the baseline
ord: 19
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16b08-3df5-7646-870f-b2a9045bc427
---
The list is the baseline [[045bc427]]: activity failures.itest, agent ContributorWithdrawal.itest, highlight session.worker.itest, navigation-ts launcher.itest, performance MemoryCaptures.itest; the `test` script fails with "No tests found" at echo, highlight, navigation, navigation-ts, ripgrep, and cloud.
