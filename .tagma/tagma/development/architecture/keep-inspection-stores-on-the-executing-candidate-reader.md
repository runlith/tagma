---
id: 01a1945c-ee25-7d17-9d98-30db0700df3b
title: Keep inspection stores on the executing candidate reader
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-87709cf48f50",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a18e5b-82cb-72c0-a23a-fd00143c084d
  - kind: relates
    to: 01a1941f-f2bb-77f3-9717-654f734e99df
  - kind: relates
    to: 01a19452-3b5d-7ced-a5f8-f3265b557b00
---
The original incident did not demonstrate lost publication: records 916 and 918 of the bindings-deep thread both started at 2026-10-31T23:35:50.800Z; the all-rules judgment failed at 23:35:53.754Z, before the ask-calls preparation completed at 23:35:56.999Z. The later sequential submit_work succeeded. Preparing vendor-ids and ask-calls concerns separate state families, and the intervening HEAD change touched graph files only. The reflection was corrected from these primary records.

A distinct current producer defect was reproduced through native submit_work → check_rules(inspection, over: change, same selection) → submit_work in an isolated project running the real law program. After completed preparation, adding only a newline to an unselected working reader source made the second landing refuse missing ask-calls state at the unchanged candidate. The runner still executed the tracked source, but store.ts hashed the working source and selected a different declarations database. The fix binds each program invocation to its candidate reader, hashes tracked reader blobs from that revision, retains disk identity for sources the loader reads outside that version and installed parser packages, and keys open handles by the resulting reader identity. It changes no inspection, scope, strictness, state family, publication transaction, distance limit or recovery policy.

The native defect test failed before the fix and passes afterward on seeds 1, 2 and 3 (one scenario, ten assertions each). Law and server package typechecks pass. The existing law program contracts pass together (two tests, 38 assertions). The behavior explanations were updated in place. No live check, server action, broad suite or independent review was run. This fixes the reproduced working-source identity race, not a claim that it caused the original concurrent incident.
