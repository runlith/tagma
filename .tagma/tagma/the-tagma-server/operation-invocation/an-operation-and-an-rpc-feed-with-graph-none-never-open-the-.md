---
id: 01a15f91-f4e1-704e-a47c-2ba5ea4147d8
title: "An operation and an RPC feed with `graph: 'none'` never open the calling place's graph on entry"
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15f7c-f8e6-72eb-835d-18b109bab315
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/caller.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/admit.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/project.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/service/body.ts
    symbol: Graphless
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/wire/operation.ts
    symbol: GraphUse
---
Whether the calling place's graph is needed is part of the operation and feed declaration: without `graph: 'none'`, admission opens that copy — building a mirror on a cold place. With the declaration, the act stands in the project on its identity and checkout alone. If the act itself needs another copy — e.g. the base graph when creating a worktree — it opens it explicitly, without opening the caller's copy along the way.

Without the declaration the graph opens: a forgotten declaration costs one extra open and breaks nothing. A mistaken declaration never silently falls into the machine graph that routed graph services answer with when there is no current graph. A body needing a service keyed `tagma/graph/*`, `GraphStore`, `GraphUnits`, `WriterRegister`, or a service marked `GraphScoped` (another module's port that invocation fills from the graph, like `HeldTaskLabels` and `HolderLabels`) fails `pair` and `routed` (`Graphless`); a new such port declares this mark, otherwise it quietly answers empty without the graph. A call that reached the graph through a routed graph service captured at assembly gets `not-served` from `RefusedGraph` and `GraphCall`, or the lookup's refusal if the checkout itself was not found. Reading the graph's `Context.Reference` (`CurrentGraph`, `ServedTree`) is invisible to the check: in such a call they are empty.

Every entry where the graph would open for the call honors the declaration. The door passes admission the operation id: the socket's own, the HTTP operation group through the `OperationCaller` middleware from the `/api/op/:id` route — MCP and `tagma op` arrive that way. The RPC feed declares `graph: 'none'` itself: subscription admission reads its declaration, keeping caller and project checks without opening the graph. Moving a call into another project or checkout (`factsAt`) also opens no graph, and a `scope` of such a call does not pick a project: a block-name lookup would open candidate graphs. Other HTTP groups open the graph as before. The native door assembles the call on its run's place graph regardless of the declaration; there the declaration honors only the move.

A call-place checkout without opening gives `ServedGraphs.checkout` — the same project policy and the same git cwd reading as with the open, so `CallerWorkspace` and `CallPlace` do not depend on the declaration. A thread mutation in a foreign project passes `WorkPlaces.enter` even without the call graph. If that place's law was never delivered, the HTTP door explicitly opens the picked checkout only to deliver the law in the refusal; the native door writes the place down for the next instruction step. Reads without a graph and operator calls need none of this work.
