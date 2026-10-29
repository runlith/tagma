---
id: 01a0de31-68d3-7b64-a2ac-876b19d870aa
title: A task's attestation is held only by its own unresolved delta, never by a peer's on the shared spec
ord: 140
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de2f-3451-73d4-b119-045957e83176",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d972-d611-779c-9a32-5c56d3bf7ecf
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/specs.ts
    symbol: taskSpecs
---
Two builders implement one decision in parallel. When one finishes with `specOk`, `Tasks.checkSpecs` refuses `spec-diverged` over the other builder's open deltas on the shared decision, so the finished task cannot end until a peer resolves work that is not its own.

Scope the attestation gate to the deltas the finishing task itself filed (`discovered-from` to it): its own recorded divergence still refuses, a peer's does not. The shared decision's truth stays guarded where it is measured — a decision never closes or verifies over any unresolved descendant spec, whoever filed it.

Done when a fixture with parallel builders finishes the task whose own delta is resolved while the peer's stand open, and an own unresolved delta still refuses `spec-diverged`.