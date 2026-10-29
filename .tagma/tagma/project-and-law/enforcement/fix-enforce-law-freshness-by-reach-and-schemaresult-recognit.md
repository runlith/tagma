---
id: 01a1515e-c917-7362-858a-5f1ae5722168
title: Fix enforce_law freshness by reach and SchemaResult recognition in swallowed-failures
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-4503-7efd-953a-51f1bf0de416",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15128-b3ed-7e98-b803-5cefbca4f00f
  - kind: discovered-from
    to: 01a1513d-881d-70a4-ae4a-4b47be10a251
---
Fix two defects: a HEAD shift outside a program rule's reach doesn't stale its measurement; skipping a line after a single SchemaError doesn't count as an arbitrary swallowed failure. Start from enforcement/rules and both swallowed-failures implementations. Check the enforce_law and inspection public contracts, types via bun run typecheck, run one independent review of the whole delivery and land the changes; the work doesn't touch enforcement/remeasure and doesn't restart the server.
