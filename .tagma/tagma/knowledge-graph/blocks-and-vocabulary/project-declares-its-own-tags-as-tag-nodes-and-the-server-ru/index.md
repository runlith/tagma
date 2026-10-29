---
id: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
title: "Project declares its own tags as #tag nodes, and the server runs their nodes like shipped catalog nodes"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/TypeFields.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/tagPrompts.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/declarationRules.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/guards.ts
    symbol: assertTagNode
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/tags/declaration.ts
    symbol: TAG_DECLARATION
  - kind: symbol
    ref: apps/tagma/server/src/graph/voice/tags.ts
    symbol: vocabularyText
---
**Value.** The project itself decides which records it keeps and how agents write them, with no Tagma rebuild. Its own tag is checked, gated, and given the core's behaviour exactly like a shipped one.

**How.** A `#tag` node: fields, edges, sources, gates, and core contracts are declared in fields, the body is the prompt for every node with that tag. `read_tags` and `read_vocabulary` give the dictionary to a thread; a `#tag` node's page shows the declaration and findings.

**Behaviour.**
- Core contracts bound by the tag give nodes statuses, holders, and a place in the work frontier.
- A declaration is checked when written. A contradictory one is refused, while a node that does not read as a declaration is named with a cause, and the dictionary works without it.
- A thread gets the dictionary summary in its start instructions. It receives a tag's prompt once, with the first nodes of that tag it read, and once more after the declaration changes.

**Limits.** A tag held by an enabled catalog is never deleted. Editing `#tag` changes every thread's start, and the answer names that edit's price.
