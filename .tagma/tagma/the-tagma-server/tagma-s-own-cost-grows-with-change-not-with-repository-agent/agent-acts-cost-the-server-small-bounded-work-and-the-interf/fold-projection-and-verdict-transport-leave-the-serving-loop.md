---
id: 01a19487-1565-7388-9082-e7b9e6850f6b
title: Fold projection and verdict transport leave the serving loop
ord: 14
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c144a8862f
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/projection.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walks.ts
---
Remove the huge-path latency regression introduced by bounded verdict retention: a previously retained verdict answered repeated explicit requests without projection, whereas an over-budget verdict now projects again on each request. The fold owner must keep a cold or evicted Holdings judgement from materializing or transporting a whole-file object graph on the serving loop. `Walks.fold` runs the `foldWork` generator there; only its base/net/link jobs run in the walk worker, while `projectWork` constructs line and region objects and `Walks.pack` serializes them before worker packing. FoldState contains Proxy line views and identity-sensitive rope sources, so moving this requires an owner-level worker/state contract, not a consumer guard. In the real Holdings bench on macOS arm64, Bun 1.4.4, one ignored 500,000-line file (7,888,890 characters, one standing record), five explicit requests re-projected after both the 64 MiB fold budget and 32 MiB compact-verdict budget declined it: 2.08–4.69 s per request and a 2,458.6 ms maximum loop-delay sample. That delay includes projection, transport, collection and scheduling; their exclusive CPU shares were not measured. The cached 100,000-line arm needed no projection and had a 16.1 ms maximum sample. Keep resident detail bounded, preserve exact landing/rollback provenance, and measure cold and evicted requests without synchronous work proportional to file text on the serving loop.