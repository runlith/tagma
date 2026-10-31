---
id: 01a18e5b-82cb-72c0-a23a-fd00143c084d
title: Per-revision inspection state is kept in immutable keyed maps shared by every revision
ord: 30
tags: ["explanation"]
sources:
  - kind: file
    ref: checks/law/architecture/boundaries.ts
  - kind: file
    ref: checks/law/architecture/calls/revision.ts
  - kind: file
    ref: checks/law/architecture/vendors.ts
  - kind: file
    ref: checks/law/maps.ts
---
Per-revision state of the architecture and declaration inspections lives in immutable keyed maps shared by every revision: `maps.ts` keeps a content-addressed hash trie in the executing reader version's law store (`map_nodes`), and `map_roots` names the root of each (family, revision). A key is found by walking at most a handful of nodes, whatever the history; a change rewrites only the nodes above its keys, and every unchanged node is shared by reference with the base, so a commit costs in proportion to what it touched and never copies, decodes or serializes the whole state. A leaf holds at most 12 entries and a node is a leaf exactly when its subtree is that small, so equal contents have one root and a map derived by changes is the map seeded from the same entries.

A family is the state of one inspection: the packages of the declaration index (a package by directory, the directories sharing a name — the last in path order resolves it — and the packages whose entry or export targets lie outside their directory, by target), the declared vendor words (one row per word, one per declaring file), the shared module cards, territories and production relations, and the call carriers each have one (`checks/law/declarations/index.ts`, `architecture/vendors.ts`, `architecture/boundaries.ts`, `architecture/calls/revision.ts`). A commit reads these only by key: a package by name, by the directories above a file or by a target outside its directory, a vendor word by the spelling a string offers, a module by its row; no judgment lists a family, and only the remeasure iterates it. The remeasure seeds a family whole; a judgment of a change derives the tree's root from the base's, or from the nearest of the six newest roots within 5000 changed files, and otherwise asks for the remeasure. Publishing checks inside its write transaction that every node the new root reuses still exists, so a sweep can never leave a root over a missing node; a missing node fails naming the remeasure. Nodes are swept only by the remeasure, and the newest 256 roots of a family are kept.

What a family stores is what findings of a change cannot be computed without: the base's module boundaries, carriers, declared words and packages. Findings themselves are never stored; each judgment computes the affected paths on both versions and answers them with explicit coverage.

A program binds its executing reader to the candidate before opening the store. The store's reader signature reads tracked source blobs from that version, and uses disk only for source files outside the version and installed parser packages, as the loader does. Otherwise a peer's unfinished working edit would select a different store even though the program still executes the same tracked reader, stranding the state its completed preparation published.
