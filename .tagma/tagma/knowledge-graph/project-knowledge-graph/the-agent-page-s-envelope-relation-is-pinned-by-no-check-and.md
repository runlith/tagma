---
id: 01a0caad-20f6-7a01-973c-7e121ae1a072
title: The agent page's envelope relation is pinned by no check, and its row figure stands unused
ord: 149
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/shared.ts
---
`numbers.ts` carries `AGENT_LIST_MAX_ROWS = 200` beside a defined-but-unused `AGENT_LIST_ROW_BYTES = 250`: the derivation comment (200 rows from the kernel's 50 KiB envelope over a 250-byte p90 row, `pinned by a check instead`) was stripped in 85601cd23e with no such check existing then or now, and the constant is still referenced nowhere in the checkout but its own definition. The day the envelope or the row cost moves, the ceiling silently stops fitting it.

Done when a check pins the envelope/row/ceiling relation, or the unused constant is removed.