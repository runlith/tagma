---
id: 01a14bc5-0df5-77c8-b1a2-69345496a638
title: By a code path an agent finds the blocks owning it and everything standing on that place
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693384c58394
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693555927d12
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/projects.ts
    symbol: OWNER_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/sources.ts
    symbol: SOURCE_READ_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/ownership.ts
    symbol: sourceOwnership
---
**Value.** Before changing code or investigating a place, the agent learns by one path what the graph knows about it, without reading code blindly.

**How.** `read_owners` — the narrowest owners of the path; `read_gauges` — every source exactly on that place, each with its area.

**Behaviour.**
- Only a standing block can own. Finished work, a replaced block, and an answered reflection hold no place.
- Narrowness counts like this: a symbol is narrower than a file, a file narrower than a directory, a deeper directory narrower than a shallow one. All equally narrow blocks return together.
- When there is no owner, the place is undocumented, and the answer says so directly.

**Limits.** Both operations read only the calling project's graph.
