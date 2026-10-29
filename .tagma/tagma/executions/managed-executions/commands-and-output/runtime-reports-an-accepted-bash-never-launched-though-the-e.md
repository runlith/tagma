---
id: 01a13248-2ed1-70d9-acfa-83d5298f933b
title: Runtime reports an accepted bash never launched, though the execution completes
ord: 25
tags: ["reflection"]
fields:
  {
    "actual": "After the Started 8901f3e9-2794-47b9-b190-ce2d2fd1651f:163 answer, runtime wrote \"call was cut off … it never ran … Send the call again\". Per that instruction the retry created 1296e7c8-fb4c-4b7e-8e10-457ba91c2707:163, and then the original execution completed: 42 tests in 11.31 s. A second needless launch resulted.",
    "command": "bash({command:\"bun test --parallel=3 ./src/composition/testing/change-record/holdings.itest.ts ./src/composition/testing/change-record/operatorWrites.itest.ts ./src/composition/testing/change-record/workspaceChangeLog.itest.ts ./src/composition/testing/change-record/retirement.itest.ts ./src/composition/testing/change-record/retirementProofs.itest.ts ./src/composition/testing/change-record/submitHoldings.itest.ts ./src/composition/testing/change-record/submitPeers.itest.ts ./src/composition/testing/landing/submitLarge.stest.ts\",workdir:\"/opt/workspaces/runlith/apps/tagma/server\",waitMs:0})",
    "expected": "For an execution whose accepted launch bash already confirmed, runtime does not offer a repeat launch as recovery for unsent arguments."
  }
---
Filed from project `runlith`.
