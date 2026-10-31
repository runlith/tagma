---
id: 01a1907d-2830-75b1-ac39-cabd06872488
title: hostedCosts.itest sometimes counts sql.execute spans no ledger root holds
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1909d-4781-7130-94f7-d0167fb43c6f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19024-7ec1-7479-b7dc-1386eb690904
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/hostedCosts.itest.ts
---
`hosted call costs` asserts the `call_hosted_tool` root's `total.statements` equals the world's `sql.execute` span delta over the call. The root's own counts are stable (219 in every run), but about one mixed run in six (ACP rig files plus a few store itests, `--no-isolate`) the delta reads 231: twelve statements ran in the window that no root finished by the `after` read accounts for. Not reproduced alone. Find what runs them — a root still open at `after`, or statements executed outside any root — and fix the attribution or the window, not the assertion.