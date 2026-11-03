---
id: 01a1a1af-bd7f-7aeb-9f8d-3c436f7f3c34
title: "Two graph-serving itests fail on main: retry clock expects the bare SqlError reason, copy freshness reads one extra block"
ord: 271
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a18b-e608-76f8-9876-6e5049331cc6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a19e-a6d1-7456-9398-40161f1838a3
---
`graph/serving/retries.itest.ts` ("background retry reaches its deadline…") expects the refusal reason `SqlError: first outage` and receives the graph-pool refusal whose reason carries the cause chain (`…; caused by ConnectionError: first outage; caused by Error: first outage`). `graph/serving/freshness.itest.ts` ("healthy reads name an unflushed sibling…", line 95) receives one block more than expected (`…cafe0099`). Both failed with and without the folder-led Add project change and touch no project creation. The retry clock test was stale — refusals now carry their cause chain — and e4ecc20a87 fixed it. Copy freshness still fails: its root cause is not yet read.