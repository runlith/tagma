---
id: 01a17fd7-6e4b-741c-85bd-26a7757dcb43
title: Core edges need no tag declaration, and target narrowing from a tag declaration still applies to them
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
sources:
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/coreLibrary.ts
    symbol: FREE_EDGES
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/knowledge.ts
    symbol: CONNECTED
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
    symbol: FREE_EDGES
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/linking.ts
    symbol: edgesLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/edges.ts
    symbol: CORE_EDGES
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/behaviours.ts
    symbol: registerBehaviours
---
Core edges are `CORE_EDGES`: `relates` and `discovered-from` may be set by any node, an untagged note included, while `supersedes` is written by its operation. `relates` ("these two things are connected") became a core edge by the operator's decision of 2026-10-28. It carries no catalog meaning, and on untagged notes live codeless projects, notebooks, and newcomers. A `[[name]]` reference in the body does not replace an edge.

A tag declaration on a core edge removes only the "tag declared it" requirement. Target narrowing `{kind, to}` from the declaration applies to it like to any edge: at binding, at birth, and on retagging. So `assertRetagged` skips one declaration check for core edges, not the whole edge fate. Skipping it entirely would let retagging give the node an edge to a target its new tag forbids.

A core edge gets no contract meaning (`BehaviourEdge`): the registry does not register such a behaviour declaration. A meaning with `from`/`to` would close the edge to nodes the contract does not serve, while a core edge is held by any node.

The shipped catalogs and the core `#tag` (`tag`, `catalog`) still list `relates` in edges. Removing it would release a new edition of every catalog into every project without changing behaviour. Besides, the target-restricted form `{kind: 'relates', to}` lives only in the declaration. `discovered-from` declarations were once removed by a graph step together with their restrictions. For `relates` that is not possible: the operator kept the tags' restrictions.
