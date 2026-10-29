---
id: 01a16e82-a855-7680-af81-75e5953932b7
title: Remeasure the graph tests whole and cut the largest shared item at the producer
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc27-77a1-99da-993a426871ff",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Graph package (ledger x10/x-graph.tsv, 342.6 s CPU "before") was not fully remeasured after edits. Run all its test files with `--parallel=2 --no-isolate`, split CPU by testbed report into load, world, tenant, body and children; cut the largest shared item at the producer (opening GraphPool, building the graph world, or whatever the profile shows), otherwise a shared CheckoutRows instance per file in rows/refs/acts where state does not leak between tests.
