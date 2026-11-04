---
id: 01a1a5fc-82e1-7350-8eeb-f015c72b0f4b
title: Background passes that read the machine store open their own cost root
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a5df-8d95-74d4-a1cd-79467ef2e8f4",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a18f1d-99e6-7406-b7e7-138631516db8
---
`hostedCosts.itest.ts` › "hosted calls retain attribution…" asserts the pool's unattributed-statement count does not move between the reads around one `call_hosted_tool`. That only holds when no background pass of the server sends a statement with no cost cause inside that window. On a slow machine some do: CI run 41766802714 failed it with 821 → 822, and under `taskpolicy -c background` it fails about 1 run in 3–4.

Statements caught inside the window (temporary trace on `connection.ts` `cost === null`, 2026-11-04):
- `select … from "custody_notice" order by opened_at … limit ?` — the `CustodyNotices.pass` tick; rooted in 703a1fc83e.
- `select "thread_inbox"."id", "thread_inbox"."thread_id", … ` (all columns, table-qualified, so a joined or nested select), twice — owner not found yet.

After rooting the custody pass the test still failed 1 of 3 slowed runs, so more independently triggered passes read without a root (the boot alone leaves ~840 unattributed statements). Find each one — a tick, a feed consumer or a reaction forked at layer build — and open its own root as note 31516db8 says a long-lived worker must, until the counter stays still in a quiet window on a loaded machine. The test's assertion stays as it is: it is the product's coverage contract.
