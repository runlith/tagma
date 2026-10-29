---
id: 01a14bc5-0df5-77c8-b1a2-69386eea6577
title: Agent reads blocks whole and a subtree to its end, page by page
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6937cc0e28a3
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/orientation.ts
    symbol: ORIENTATION_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/graph/reading/block.ts
    symbol: blockReadsLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/voice/zonePage.ts
    symbol: zonePage
---
**Value.** The agent gets everything about a block at once (body, links, sources, who finished the work) and can read a subtree to its end. That is what review and a spec need, where partial reading means a wrong conclusion.

**How.** `read_block` — one or several blocks with a subtree outline; `read_zone` — a subtree in outline order, page by page.

**Behaviour.**
- Reading a block gives references both ways, the work's end, and an answer to a reflection. A view runs its query when read.
- Resting children hide by default and show on request. When reading a zone, standing children of a resting block rise to the nearest standing ancestor.
- A list reads whole or not at all: the refusal names the block that did not read. Other projects' blocks read in their own graphs.
- The tag prompts the thread has not yet received arrive with the zone page.

**Limits.** A block in the trash is not read by these operations. A zone does not run views.
