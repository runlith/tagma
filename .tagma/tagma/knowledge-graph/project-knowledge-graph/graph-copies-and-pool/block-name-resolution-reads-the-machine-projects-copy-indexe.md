---
id: 01a11b65-f219-70d5-8e2c-66aac7c0b002
title: Block-name resolution reads the machine projects' copy indexes without opening their graphs and keeps the found copy's address
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockTitles.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/copyIndex.worker.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: indexHolding
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: titlesAcross
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/git.ts
    symbol: checkoutsOf
---
The current copy has priority; `read_titles` looks for missing names in the project's other copies first, then in all copies of every registered project on the machine and global together. Copies of one block give one address; a short name of two different blocks in one search level refuses with `ambiguous-name`. Another copy's answer keeps the project and `branch`: null for the main checkout or the branch name.

Apart from the current one, the search reads a copy by its index — the copy's mirror with a `block_name_idx` index on the name tail — through the worker connection with `query_only`, without opening the graph or walking the tree; the project's worktree list comes from `checkoutsOf`, which calls git only when the repository's worktree metadata changes. The old walk re-read every cold copy of every project from files on every search (attach, topology, full tree walk): seconds per copy, 15 s on the operator's machine. Index cost: a cold copy answers what it knew at its last serving, and a copy the server never opened has no index and takes no part in the search; a copy the pool holds is under a watcher and always current. The worker takes the SQLite engine shipped by the kit (`selectEngine`) because it reads the mirror WAL next to the server's writer.

`crossing.elsewhere` asks the same index and opens a graph only for the project whose main copy holds the name — live or in trash, because name operations (`restore_block`) also find a deleted block — or has no index or is unreadable. `read_titles` does not name trashed blocks.

The app expands the current-copy address relative to the link source's GraphRung. Search yields the navigation address; reading or writing happens after moving to the found copy. The thread-feed block card takes the address from the operation answer — the write's `graphCopy` project and branch, or the read row's `projectId`. Search is needed for a list without an address and for an old write answer without a non-main-copy branch. Until search answers or refuses, a link carries no address: the link source's project is not substituted because a foreign block under it refuses with `place-mismatch`. A link without an address opens next to it in the copy the search named (`BlockTitles.copy`), and in Knowledge — where the search pointed, unless the operator has left the click page meanwhile (`BlockTitles.open`). A changed row with the same producer-supplied short name but another identity invalidates a previously resolved partial address; the request is re-resolved even if its last answer was ambiguous. The short name is an invalidation key, not a client-side identity resolver.
