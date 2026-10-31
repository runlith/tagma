---
id: 01a1945c-ee25-7d17-9d98-30db0700df3b
title: Share the required per-revision inspection state across preparation and landing
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-87709cf48f50",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a18e5b-82cb-72c0-a23a-fd00143c084d
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654f734e99df
  - kind: relates
    to: 01a19452-3b5d-7ced-a5f8-f3265b557b00
---
A current submit_work refused gated inspections for missing vendor-ids and ask-calls state, while the named check_rules preparation at the same HEAD did not satisfy the following rule run; an unchanged later landing succeeded. Reproduce the preparation-to-judgment boundary and fix state identity, publication or reader ownership at its producer without changing any inspection's rule, scope, strictness or proof. Preserve the concrete refusal and exit contract rather than adding serial warm-up retries.