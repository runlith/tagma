---
id: 01a14c14-a11c-7ce8-9d84-632614955e6b
title: A team graph commits itself, only on request, or never — the project setting decides
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6328ba8c9922
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/advance.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/commits.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/tree.ts
    symbol: TREE_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: graphCommit
---
**Value.** The graph in the repository neither piles up uncommitted files nor mixes with code commits: Tagma lays it with its own commits on the same branch.

**How.** The project `graph.commit` setting in Settings → Graph files: Tagma, On sync, or Nobody. Manual commit is the `sync_graph` operation and the Sync button in the checkout changes' Graph section.

**Behaviour.**
- Tagma: everything changed under `.tagma`, after a pause in writes, leaves in a separate graph commit; others' staged code doesn't get into it. The commit comes from `Tagma <agent@tagma.dev>`, so GitHub links it to the `tagma-dev` account. Its subject takes the repository's own shape and identifies a uniquely leading block, shortening its title at a word boundary when needed; its body lists every act with the complete title.
- On sync: the tree is committed only by an explicit `sync_graph`.
- Nobody: the tree stands in the checkout as ordinary uncommitted work, and `sync_graph` refuses.
- A failed commit repeats with a growing pause; the tree files stay in place.
- `sync_graph` neither merges, resolves conflicts, nor pushes.

**Limits.** `sync_graph` serves team storage only. In stealth, Tagma's own git commits graph acts; the checkout's automatic policy still carries the team-file deletions left by a storage move. Moving storage neither commits unrelated checkout files nor bypasses an unfinished git operation.
