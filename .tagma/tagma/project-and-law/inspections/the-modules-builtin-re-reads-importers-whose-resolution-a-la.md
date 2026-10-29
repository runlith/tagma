---
id: 01a10c9f-d6fb-79e4-8831-9fe64799e983
title: The `modules` builtin re-reads importers whose resolution a landed path changes
ord: 17
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a10c7f-b81b-74a4-9238-ce861a12cdbd
sources:
  - kind: symbol
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
    symbol: affected
---
`affected` in the `modules` builtin re-reads importers in only three cases: a path under `base` was deleted, a path was moved, or a manifest changed. An added path does not force re-reading unchanged files whose resolution it changes:
- an import that was unresolved starts resolving;
- a new file shadows the import's previous target.

This limitation is recorded in the declaration's limitations (`declaration.ts`): only the rule's next full measurement finds such a thing.

**Why it matters.** A landing can carry a violation standing on someone else's uncommitted path ([[1a12cdbd|mechanism note]]). It judges the edge to that path against the module map as it was at its landing moment. If the map changes before a teammate's landing, or another added file shadows the candidate, no gate judges the appearing edge until a full measurement.

**Where to start.**
- `affected` itself lives in `apps/tagma/inspection/src/packs/architecture/modules/implementation.ts`.
- Importers of an added path can be found via `tree.mentions`, as the `names` builtin does. The search word is the file name's stem, and for `index.*` the directory name.
- Package doors that name a file by the package name are not found by that word. They need a separate solution.
- The code-facts impact index (`reverseIndex`, `impactOf`) already tracks probes of missing paths per file.

**Cost.** Measure it on `implementation.bench.ts` for landings that add files with common name stems (`types`, `state`, `index`): each such landing reads the imports of every found file.

**Done when:**
- a landing that adds a file which an unchanged file imports with no relation or into another module's private part is rejected by the gate;
- the test for it is red before the change;
- the limitation in the declaration is fixed;
- the cost is measured on the bench.
