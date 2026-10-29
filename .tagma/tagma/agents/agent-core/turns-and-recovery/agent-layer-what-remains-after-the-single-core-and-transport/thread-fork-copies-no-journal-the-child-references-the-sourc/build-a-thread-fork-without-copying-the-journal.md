---
id: 01a151df-e920-73d7-9b09-09e500898729
title: Build a thread fork without copying the journal
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-567a-72f4-83ce-3134e2c0b824",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09e4d7c40fd9
---
Builds [[d7c40fd9]]. Start with the map of writers that mutate source rows in place (list in the spec), and the `ThreadAggregateStorage` port in `packages/agent/src/thread/storage/aggregate.ts`; choose between a fold overlay and reading "as at `through`" by measurement before the rest of the work.

Done when the spec's acceptance criteria hold, including the 1 MB vs 1 GB bench.

Outcome: commits `7095541d2` (layers `thread_base`, transcript CoW, offload/return/delete, files via layers), `65fa21a0df` (child search via the source index), `96df013d3a` (bench), `3e42cf4a2d` (review fixes: branch slice as history excision, index CoW, search without a thread finds the branch, withdraw after copy-up, freeing the remainder in the source queue, parameter limits). Measurements are in the spec. Not proven: the race of deleting the last branch against returning the source is fixed by construction (freeing in the source journal queue) and was not reproduced by a test; `rewind.stest.ts` "restore…" and several agent conformance suites failed on timeout at load average 26 on 12 cores and were not rechecked separately without load; the child's `read_thread` fields were not compared field by field against a copy; restoring a branch from rollout is [[a0db1661]].
