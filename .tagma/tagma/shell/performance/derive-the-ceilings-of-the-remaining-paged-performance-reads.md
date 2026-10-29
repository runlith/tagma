---
id: 01a13f82-7d14-770c-80b6-42324f21f5d8
title: Derive the ceilings of the remaining paged performance reads from their row weight
ord: 29
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13f63-559c-7cb3-89b6-c44b6b237a7d
sources:
  - kind: file
    ref: packages/performance/src/protocol/queries.ts
---
After the slow/overview cap in the [[6b237a7d|reflections task]], the remaining leaf queries in protocol/queries.ts still take any positive limit; metrics carries the same histogram arrays, trace full spans, while captures/vitals/stalls/load need their own samples. Measure each family's rows in the tool's actual envelope, cap its schema, and keep honest cursor/total without an extra pass. Verify the oversized-limit refusal and the size of a representative serialized response; a single heavy record must still be spooled whole.
