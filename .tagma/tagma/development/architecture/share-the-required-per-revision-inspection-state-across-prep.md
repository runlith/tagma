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
A current submit_work refused gated inspections for missing vendor-ids and ask-calls state. The reported all-rules check and ask-calls preparation actually started together, and the former failed before preparation finished; the later sequential submit_work succeeded, so that record does not establish lost publication. Reproduce the completed preparation-to-judgment boundary, including a peer's working edit while the judged reader stays unchanged, and fix any demonstrated state identity or reader ownership defect at its producer without changing rule scope, strictness, proof or distance limits. Preserve the concrete recovery contract rather than adding warm-up retries.