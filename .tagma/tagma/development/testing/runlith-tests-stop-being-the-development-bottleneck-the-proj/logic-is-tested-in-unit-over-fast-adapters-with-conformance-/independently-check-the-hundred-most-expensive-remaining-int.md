---
id: 01a16e4b-f583-73c5-b740-8b3a6ba0d3cf
title: Independently check the hundred most expensive remaining integration tests outside executions
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2ab6-7368-a8dd-8e28322636c7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Independently check the hundred most expensive remaining integration tests outside executions: for each of the current 100 most expensive itest files by x10/before.json and author ledgers, name the contract, the consumer, cheap coverage and a keep/delete/merge/unit verdict. No tests or source edits. x10/audit.tsv records 100 dissections: 81 keep, 15 logic moves to unit (one already done by the owner), 3 merges and 1 deletion; unfinished owners carry route-only. Cost is the before max-sample, and for 0-test records the after_s explicitly marked from the ledger; this is neither a CPU sum nor a savings promise.
