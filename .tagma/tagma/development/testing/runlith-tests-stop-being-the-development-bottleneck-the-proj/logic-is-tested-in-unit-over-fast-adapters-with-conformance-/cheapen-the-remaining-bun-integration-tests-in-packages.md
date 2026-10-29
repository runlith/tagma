---
id: 01a16e40-a82c-7d6f-b837-1b76c736a38e
title: Cheapen the remaining Bun integration tests in packages
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2b0b-7892-afdb-3123a319f97d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Dissect the remaining Bun integration test files in packages outside execution-host, executions and testbed, starting with the most expensive; keep narrow conformance of real adapters, remove duplicates, check logic on fast adapters. Reconcile open files with x-packages; record CPU and outcomes in x10/x-exec-a-packages.tsv, check each changed kept file separately on seeds 1/2/3. In the chosen expensive slice 16 test files changed: 201 tests passed seeds 1/2/3 separately with --no-isolate; outcomes and indicative cold CPU recorded in the ledger. This is not a full review of the small package tail nor a measurement of total speedup; the comparative measurement stays with the shared delivery.
