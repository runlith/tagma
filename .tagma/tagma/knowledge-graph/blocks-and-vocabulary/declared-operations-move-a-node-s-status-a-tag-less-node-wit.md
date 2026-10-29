---
id: 01a14bc5-0df5-77c8-b1a2-6932d9f44168
title: Declared operations move a node's status; a tag-less node with no lifecycle never ends
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/StatusMenuItems.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/actions.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/TagCatalog.svelte.ts
    symbol: TagCatalog
  - kind: symbol
    ref: apps/tagma/server/src/graph/behaviours.ts
    symbol: graphBehaviours
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/lifecycle.ts
    symbol: checkTransition
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/lifecycleBehaviour.ts
    symbol: lifecycle
---
**Value.** The server runs the lifecycle, not an agent's word: status cannot be rewritten as a field, and knowledge with no end (a module, an explanation) cannot be "closed" by mistake.

**How.** A tag declares status words and allowed moves. Work operations make the moves; a move with no operation of its own is made by `update_block`. In the app the block's status chip and menu offer only legal moves.

**Behaviour.**
- A node is born on the initial word.
- A move that has an operation refuses through editing and names that operation. An illegal move refuses with the list of legal moves from the current word.
- A node with no lifecycle never ends; the refusal offers to replace it with a successor or rewrite it in place.
- A declaration with dead-end or contradictory words is refused.

**Limits.** A node with several tags obeys every tag's contracts at once.
