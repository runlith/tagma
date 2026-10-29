---
id: 01a11901-470f-7498-99ae-69eac457afe4
title: "Kit: delete repeated runtime-fact derivations — entry deltas, feedPosition, call outcome, input receipts"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e0eb9c2129
  - kind: relates
    to: 01a11901-5360-733e-9ca2-9123ae16171c
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e618d547b2
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e86e1372ac
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9122d46485b4
---
When the producer ([[c3436715]], [[9f3bb3f9]]) serves entry deltas, `feedPosition`, `ThreadToolState` with outcome, and receipts: delete `entriesFromAgentMessage`, the client-side `AgentMessageFold`, heuristics, run-end synthesis, finalization of interrupted parts, string predicates, `toolRefused`, data-part guards; `FeedVerdicts` by the table; `PendingTurns` resolves outcomes by receipt. Thread liveness comes only from `RunStatus`, and local command state stays separate from it. Delete:
- `life` assignment in `ThreadSession.svelte.ts` (run adoption, local reset, stop suppression);
- working rows fabricated by `Births.svelte.ts`;
- the second `liveStatus.ts` verdict assembled from run, life, stage, and phase.

Done: consumer equivalence test on the producer corpus; receipt tests.
