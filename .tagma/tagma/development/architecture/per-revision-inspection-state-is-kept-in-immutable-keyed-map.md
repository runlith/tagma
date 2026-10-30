---
id: 01a18e5b-82cb-72c0-a23a-fd00143c084d
title: Per-revision inspection state is kept in immutable keyed maps shared by every revision
ord: 30
tags: ["explanation"]
sources:
  - kind: file
    ref: checks/law/maps.ts
  - kind: file
    ref: checks/law/architecture/measured.ts
  - kind: file
    ref: checks/law/architecture/vendors.ts
  - kind: file
    ref: checks/law/architecture/calls/revision.ts
---
Per-revision state of the architecture and declaration inspections lives in immutable keyed maps shared by every revision: `maps.ts` keeps a content-addressed hash trie in the shared law store (`map_nodes`), and `map_roots` names the root of each (family, revision). A key is found by walking at most a handful of nodes, whatever the history; a change rewrites only the nodes above its keys, and every unchanged node is shared by reference with the base, so a commit costs in proportion to what it touched and never copies, decodes or serializes the whole state. A leaf holds at most 12 entries and a node is a leaf exactly when its subtree is that small, so equal contents have one root and a map derived by changes is the map seeded from the same entries.

A family is the state of one inspection: the packages of the declaration index (a package by directory, and the directories sharing a name; the last in path order resolves it), the declared vendor words (one row per word, one per declaring file), the coupling totals, module cards, territories and the modules whose representative path is a given path, and the call carriers each have one (`checks/law/declarations/index.ts`, `architecture/vendors.ts`, `architecture/measured.ts`, `architecture/calls/revision.ts`). A commit reads these only by key: a package by name or by the directories above a file, a vendor word by the spelling a string offers, a module by its row; no judgment lists a family, and only the remeasure iterates it. The remeasure seeds a family whole; a judgment of a change derives the tree's root from the base's, or from the nearest of the six newest roots within 5000 changed files, and otherwise asks for the remeasure. Publishing checks inside its write transaction that every node the new root reuses still exists, so a sweep can never leave a root over a missing node; a missing node fails naming the remeasure. Nodes are swept only by the remeasure, and the newest 256 roots of a family are kept.

What a family stores is what findings of a change cannot be computed without: the base's per-module totals, carriers, declared words and packages. Findings themselves are never stored; each judgment computes the affected paths on both versions and answers them with explicit coverage.

A coupling finding stands at the module's representative path, which a module keeps after losing the file, so another module's change can cover a path an untouched module's findings stand on; the `r:` rows list the modules per representative path, and a judgment adds every such module to its answer before it names the covered paths. Findings the answer relocates onto changed files are those of the modules the change touches.
