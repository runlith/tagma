---
id: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
title: "Typed edges link any blocks, in their own project and across projects: relation, wait, implementation, provenance"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69369c55efea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693ed42057f8
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694599fa9ace
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/edges.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/linking.ts
    symbol: edgesLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/cli/listings.ts
    symbol: listings
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/workBehaviours.ts
    symbol: work
---
**Value.** A link between blocks carries a meaning the server understands: what connects to what, what waits on what, what implements which spec, what grew out of what. The work frontier and answers to reflections build on that meaning.

**How.** `link_blocks`, `unlink_blocks`, edges at block birth, and in `apply_batch`; the `tagma edges` CLI prints every project edge. On the block page edges group by meaning and direction.

**Behaviour.**
- Any block sets the `relates` and `discovered-from` links with no declaration, an untagged note too. So the operator decided on 2026-10-28: `relates` carries no catalog meaning, and projects without code, notebooks, and newcomers live on untagged notes.
- The rest of the edges are declared by the tag. A tag may narrow which tags its edge leads to, `relates` too; the narrowing applies at linking and at tag change.
- An edge also leads to a block of another project on the machine. The edge identifies the target graph by its root, so on a colleague's machine it resolves to their copy. A target missing on the machine reads as "not on this machine".
- Waiting (`waits-on`) keeps work blocked until the blocker finishes or is replaced, and allows no cycle, including through another project. A wait target missing on the machine keeps the work blocked too.
- Implementation (`implements`) leads to a standing spec; a spec whose work someone holds shows as under construction.
- Finished work grown from a reflection answers it.

**Limits.** Only its own operation records replacement, and it never crosses projects. Module import edges are written only by `set_module`. A `[[name]]` reference in the body is navigation, never an edge.
