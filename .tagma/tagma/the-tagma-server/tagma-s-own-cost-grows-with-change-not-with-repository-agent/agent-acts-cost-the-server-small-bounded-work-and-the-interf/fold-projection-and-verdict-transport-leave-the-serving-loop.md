---
id: 01a19487-1565-7388-9082-e7b9e6850f6b
title: Fold projection and verdict transport leave the serving loop
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-915a-79ee-8b2e-dfe1853d03e0",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c144a8862f
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walks.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/projection.ts
---
Remove the huge-path latency regression introduced by bounded verdict retention: a previously retained verdict answered repeated explicit requests without projection, whereas an over-budget verdict now projects again on each request. The fold owner must keep a cold or evicted Holdings judgement from materializing or transporting a whole-file object graph on the serving loop. Before this change, `Walks.fold` ran the `foldWork` generator there; only its base/net/link jobs ran in the walk worker, while `projectWork` constructed line and region objects and `Walks.pack` serialized them before worker packing. FoldState contains Proxy line views and identity-sensitive rope sources, so moving this requires an owner-level worker/state contract, not a consumer guard. In the real Holdings bench on macOS arm64, Bun 1.4.4, one ignored 500,000-line file (7,888,890 characters, one standing record), five explicit requests re-projected after both the 64 MiB fold budget and 32 MiB compact-verdict budget declined it: 2.08–4.69 s per request and a 2,458.6 ms maximum loop-delay sample. That delay includes projection, transport, collection and scheduling; their exclusive CPU shares were not measured. The cached 100,000-line arm needed no projection and had a 16.1 ms maximum sample. Keep resident detail bounded, preserve exact landing/rollback provenance, and move cold/evicted whole-file projection and graph transport off the serving loop. In the implemented worker-resident arm, replay, projection, step-debt formation, rollback and packing execute together; only shared text/column buffers and small handles or recall metadata cross. The same 500,000-line fixture still recomputes after both cache budgets decline it: five requests took 1.66–6.59 s, so the old huge-query latency is not restored. Main-thread fold input preparation measured 0.34–3.09 ms and native fold sends 0.037–0.069 ms after sharing hunk text; maximum loop delay was 181.2 ms versus 2,458.6 ms in the earlier arm. This is one shared-machine sample, not a global responsiveness gate: existing raw-byte sends reached 51.1 ms, and scheduling/collection were not separated. The existing total replay-cache allowance is preserved by splitting it between worker state and client recall metadata, with the worker half divided by pool capacity.