---
id: 01a1366a-c5c6-7c12-9e44-45eeae07ab15
title: "Stall keeps whole every unit open across it: agent runs yield a third of recorded spans, and the 8 GB store evicts a day of history"
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a136b4-0543-7cd5-a38e-72a639792ad3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1362d-a0db-7666-88df-6b9d95a079fc
sources:
  - kind: file
    ref: packages/performance/src/TraceSampler.ts
---
The server telemetry store writes ~340 MB and ~460K spans per hour and, at the `performance.maxStoredBytes` limit of 8 GB, evicts old hours after about a day. Eviction is the “1.2M dropped spans per session”: `sessionDroppedKinds` sums records of evicted segments (`stored-limit`), not intake losses — the queue (`pendingBytes`) never overflowed in the measurements.

**What makes the volume (segment 16:00–16:58 UTC 2026-10-13, 462,290 spans):**
- roots, always longer than 250 ms (`CheckoutStatus.comparison`, `.reading`), kept whole as slow — 12,084 traces, ~152K spans. Fixed in the [[95a079fc|idle-CPU work]]: the 250 ms ceiling applies only until the hundredth completion of a name.
- 20 traces ≥ 10 min long — 168K spans (36%), almost all agent runs (15–25K spans each) and `Holdings.*`. None chosen by hash. They are held by the rule “stall keeps every unit open across it”: a model step runs ~15 s, ~95 stalls per hour, so almost every step ends up open across someone else's stall and is kept whole with all its `sql.execute` and `AnthropicMessages.lower*`.
- spans within ±2.5 s of stalls — 105K (23%); inside the stalls themselves — 4.5K.

**Proposal:** a stall keeps the spans running across it (and their ancestors up to the unit), not the whole unit; a unit is kept whole only for its own failure or slowness. This changes the decision of the closed spec [[cd95a677|on scoring traces by units]] (the “stall keeps the units open across it” item), so the choice is the operator's.

**Done when:** under the same load the hourly volume drops severalfold, while `read_performance stall` still names what ran across the stall.
