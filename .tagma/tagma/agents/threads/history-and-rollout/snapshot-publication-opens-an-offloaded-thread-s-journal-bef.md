---
id: 01a14f46-9f50-76fd-9731-dfc2a92c2538
title: Snapshot publication opens an offloaded thread's journal before the snapshot lock, and offload and rollout forming take uses.rest only inside the journal lock
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14f3e-a5c6-7cc7-afbe-7f4b297b18ea
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/engine.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
---
A whole publication reads its journal under `atCut`. Opening a compressed offloaded rollout or settling an interrupted file publication may enter the thread journal lane, so residence prepares that source before `atCut` and holds its use until the read finishes. Offload and background forming refuse an in-use source; otherwise they could change the file during that read.

Order is fixed: the journal lane precedes the exclusive rest use. A journal step can publish before returning; if rest took its exclusive use first, it could wait for that lane while the publication waited for the use. Keeping the order prevents that cycle. Source preparation also stays outside `atCut`, because a writer holding the journal lane can need the cut for its committed handoff.

The drain and status-deadline forks replace their contexts with the snapshot owner's construction context, carrying the causing act's cost explicitly. A context merge would preserve per-call lane and transaction marks absent from that construction context. In particular, an expired journal `within` mark could falsely authorize inline preparation of a compressed source without owning its lane.
