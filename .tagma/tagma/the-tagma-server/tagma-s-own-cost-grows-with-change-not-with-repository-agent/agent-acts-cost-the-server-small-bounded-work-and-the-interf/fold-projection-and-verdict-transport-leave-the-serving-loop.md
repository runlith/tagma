---
id: 01a19487-1565-7388-9082-e7b9e6850f6b
title: Fold projection and verdict transport leave the serving loop
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-915a-79ee-8b2e-dfe1853d03e0",
    "status": "done"
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
Remove the serving-loop regression introduced by bounded verdict retention: a cold or evicted Holdings judgement must not construct or transport a whole-file line-object graph there. Keep resident detail bounded and preserve exact landing, rollback, request freshness and partial-input recovery.

Replay, projection, overwrite materialization, evidence decoding, nobody classification, per-record counts, rollback and packing now execute together in the walk worker. Identity-sensitive FoldState graphs stay behind revisioned recalls. Lost or evicted recalls take the existing alignment fallback through full inputs; partial input is never replayed as independent history. Shared buffers carry text sides, hunk text, serialized witness facts and verdict columns. Holdings summaries and rollback consume worker-reduced facts without expanding every lazy line. The path-change report reads debt identities without fetching their windows. Priority ranks eligible jobs, so an urgent affinity-blocked recall does not idle unrelated runnable capacity. The existing total replay allowance is split between the worker-state pool and process-wide client recall metadata; pool capacity divides the worker half.

Measurements are shared-machine samples on macOS arm64, Bun 1.4.4, not controlled A/B latency proof or the global responsiveness gate. The real-owner fixture has one ignored 500,000-line file (7,888,890 characters), one standing record, eight ordinary paths and five requests per case. Its worker state exceeds the 64 MiB worker replay ceiling, and detailed evidence exceeds the 32 MiB compact-verdict ceiling, so every large explicit request recomputes. Before this follow-up, creation-only requests took 2.08–4.69 s with a 2,458.6 ms maximum loop-delay sample. The worker-resident creation-only arm took 1.66–6.59 s with a 181.2 ms maximum; main-thread fold input preparation was 0.34–3.09 ms and native fold sends 0.037–0.069 ms. Its main-thread CPU profile contained no projection/materialization frames.

After the review corrections, a whole-file step-debt window plus a released nobody line took 2.20–5.30 s per judgement, with an 84.3 ms maximum loop sample, 4.28–36.82 ms input preparation and 0.043–0.071 ms native fold sends. Rollback preparation for the same 500,000-line recorded creation took 1.29–3.45 s, with a 46.5 ms maximum loop sample, 0.31–11.92 ms input preparation and 0.029–0.071 ms fold sends; the owner returned the expected file deletion and 500,000-line row tally. Existing raw-byte sends reached 54.9 ms across these cases. Cache-miss wall time, raw-byte transport, collection and scheduling remain separate limits; their exclusive costs were not established.

Final checks: bun run typecheck passed; 171 tests in 19 affected files passed after the corrections, covering pure fold/contracts/fuzz, actual workers, exact/fresh Holdings, ignored inputs, retirement, rollback, equal-line landing, step shaping, dependencies and changes feed. The changed fold, worker and lane test files each passed alone on seeds 1, 2 and 3; the visibility and queue-owner cleanup passed a further targeted caller check. One independent delivery review identified three performance defects, all confirmed along their callers and fixed in this delivery; no second review was run. No live server or browser check was performed.