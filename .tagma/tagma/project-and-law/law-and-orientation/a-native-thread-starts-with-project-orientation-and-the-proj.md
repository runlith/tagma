---
id: 01a14c14-a11c-7ce8-9d84-633222b5a1a1
title: A native thread starts with project orientation, and the project sets the map size in it
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6333615db78c
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/map.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/prime.ts
    symbol: orientationLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: mapBudget
---
**Value.** An agent without context sees from the first turn what the project is about, how it splits into areas, and who holds what, without spending a turn on an overview.

**How.** By itself, in the first turn of a thread with the graph capability. The map size is the project's `orientation.mapBudget` setting (Settings → Orientation).

**Behaviour.**
- Orientation: the root body, the global graph link, the area map by names, work in progress with holders.
- A thread born over a subtree gets its body, its branch's catalogs on the map, and only its own work in progress.
- A map over budget cuts depth, and every area tells how many of its children it did not show; when no area fits, their count remains.
- A foreign CLI gets the same orientation, with the project law added.

**Limits.** An agent without the graph capability gets no orientation.
