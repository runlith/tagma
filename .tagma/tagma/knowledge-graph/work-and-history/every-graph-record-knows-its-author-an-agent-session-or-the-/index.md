---
id: 01a14bc5-0df5-77c8-b1a2-6944756614a0
title: Every graph record knows its author — an agent session or the operator's hand
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/SessionRegistry.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/WriterBadge.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/journal/authors.ts
    symbol: authorName
  - kind: symbol
    ref: apps/tagma/server/src/graph/cli/listings.ts
    symbol: listings
---
**Value.** Every graph record has an author: an agent thread or the operator's own hand. That shows who wrote what and whom to ask.

**How.** The server records the author itself. `read_session` resolves a writer's numeric id, including a block's holder, into a writer and the thread's full address. `list_sessions` and the `tagma sessions` CLI read the project's writers page by page with a total and continuation. In the app the author badge stands at the work holder, and at whoever finished it, and a thread itself shows what it holds and wrote in the graph.

**Behaviour.**
- A Tagma thread shows by its name, as in the thread title, with an agent icon, and opens on click. A foreign-CLI session shows by its harness and key, and a click copies its id. The same badge marks the author on the block page, in the Diff strip, in outline and sidebar, in the block menu, in the journal, and in rule refusals.
- A call with no thread (from app, CLI, or HTTP) is recorded as an operator call.
- The work's end keeps who decided and why.

**Limits.** The list covers writers of the chosen project only. A writer's numeric id belongs to the graph copy: address reading keeps the project and checkout of the block's original reading. A foreign CLI session has no Tagma thread of its own.
