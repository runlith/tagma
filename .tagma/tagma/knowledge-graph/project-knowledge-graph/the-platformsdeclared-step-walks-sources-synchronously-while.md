---
id: 01a15134-0b9f-7e2c-809e-ec1e59925d6e
title: The platformsDeclared step walks sources synchronously while a live server opens the copy
ord: 77
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-49be-7da5-887d-c66410d059d4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/platformsDeclared.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/platformsDeclared.worker.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/platformsWire.ts
---
Remove the synchronous walk over sources in platformsDeclared when a graph opens lazily, keeping the step itself and its ported result. By the operator's direct decision the steps do not fold: GRAPH_STEPS, GRAPH_BASE=null, the other steps and their tests stay as in HEAD; related changes to the rows step, birth, and base checks are dropped.

Result: SQL selects only rows with enforcement checks modules/loads/platforms. Git listing, file reading, import parsing, parameter conversion, and JSON comparison run in this step's worker in steps/. The disk listing is created lazily and once per job; the walk is needed only for builtin platforms without params.platforms and params.unmigrated. The driver decodes the answer and writes the changed rows transactionally. An unsupported port still leaves unmigrated; a worker failure gives a typed graph-pool refusal before the marker is written and promoted.

Verified by the existing public platformsDeclared.itest: stored-document equivalence, idempotence, and unsupported cases. Latest joint run with storageMove.stest: 3 pass, 33 assertions, 18.1 seconds. Bun run typecheck exited 0, server — 5,088 files with no errors. The same independent reviewer of the whole delivery [[01a15142-316c-7442-9c63-acbe43725f62|fs-graph-review]] read the final worker and matched the algorithm against HEAD: no new findings. The heavy work's locus is confirmed by reading the driver→askOnce→worker chain; real latency on a large repository was not measured. The operator's server was not restarted.
