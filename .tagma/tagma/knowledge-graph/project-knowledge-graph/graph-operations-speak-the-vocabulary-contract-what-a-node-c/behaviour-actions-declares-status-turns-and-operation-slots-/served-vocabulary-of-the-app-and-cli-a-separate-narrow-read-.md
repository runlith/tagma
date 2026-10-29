---
id: 01a132bf-ca54-75da-a35f-23e2721374ce
title: Served vocabulary of the app and CLI — a separate narrow read-interface implementation, not a `TagIndex` mode with an empty registry
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13299-7008-7e1f-99b0-2cc9e15de3a1
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TagCatalog.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/tagIndex.ts
---
`TagIndex.served` (e15de3a1) builds the table from the `read_vocabulary` answer via `core(tag)` with an empty behaviours registry. Registry-dependent `TagTable` members answer silently wrong in this mode instead of "unavailable": `edgeRule` → `null`, `semanticEdges` → `[]`, `redeclare` refuses, `contracts` means "tag-bound" rather than "registered"; `actionsOn` for a multi-tag node merges tag projections while the server projects the node's contracts together. After 8d21b871 the app status menu calls `actionsOn`: a node with `core/lifecycle` on one tag and `core/holder` on another gets `claim_task`/`release_task` on the server but a plain turn in the menu, which the server refuses. This is a second derivation of one fact (rule 51c66cb6): only the server computes the per-node projection, the client reads its answer; the browser also loads `compiler.ts` for `core()`.

To do: declare a narrow read interface consumed by the app and the CLI, plus a served implementation returning only what arrived from the server (including the per-node projection if the client needs it). Also decide there what the app shows before the server answers: an empty vocabulary now yields `isTerminal`/`rests` = false, so done/closed rows flash briefly in the outline (after a load error — until resync).

Done: the app and CLI no longer import `TagIndex` or the registry; `TagCatalog`/`ReadingLens` typecheck and tests are green.
