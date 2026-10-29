---
id: 01a151df-e920-73d7-9b09-09da716be568
title: A model step without compaction never walks the whole thread history
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
  - kind: relates
    to: 01a14041-5389-7b0a-9226-5e6eeeb8d7a5
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/prune.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/pruner.ts
---
`ThreadCompaction.prepare` runs on every model step and walks the whole history each time: `pictureLocations` and `prunePictures`, the backward `pruneToolOutputs` pass to the first message, `clearToolOutputs` and `omitThreadMedia` over the stored history (`packages/agent/src/thread/run/ThreadCompaction.ts:348–353`, `thread/compaction/prune.ts`, `pruner.ts`). The work is synchronous on the event loop and grows with the already-handled history — against [[7a910861]]. An identity-digest cache removes hashing but not these passes; hashing the whole history on the first post-restart run is a separate task [[eeb8d7a5]].

To do: prune and picture state lives with the thread and extends by tail; a pass needing the whole picked history (summary, prune at compaction itself) is bounded by it and runs in the owner's worker.

Done (31aaad7d50): `HistoryIndex` holds turn openings, the last answer, uncleaned results with their cost, and live pictures; `ThreadPruner.index` extends it by tail while history continues the same by message identity ([[167864f9]]). Prune, picture budget, and their addresses compute from the index; the meter skips the shared prefix and extends revealed names by tail; `observe` measures with its own meter. Test `ThreadCompactionStep.test.ts`: the second step reads no property of earlier messages and their results. Unproven and undone: identity matching stays a linear pass over references (contents unread) — only the history owner can remove it by reporting that history continued the same; a step where prune decided something hashes history for settlement and rebuilds the index after the fold.

The compaction pass moved to a worker in [[b5059c61]]: the core has no worker-execution port, and the transfer shape still needs designing. Full `lower` passes before a request in [[84232f86]].

Proof: a budget test of an ordinary step over a long synthetic tail — the `prepare` and meter message count does not grow with the already-measured history length (a count, not time).
