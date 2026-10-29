---
id: 01a13b37-5351-7e3a-bda9-f7c22e414755
title: "Readings: Data or Schema for errors, where Effect.result is justified, which hand-rolled mechanisms Effect primitives replace"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ad9-62d0-709e-8021-29b44a8e3ed8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
---
Three short readings, code reading only, no edits:

1. Errors: when `Data.TaggedError`, when `Schema.TaggedError` (Effect's authors use both, plus `Schema.Error`; the criterion is unwritten). Where our errors cross a wire or storage and require a schema.
2. `Effect.result` + branching on `_tag` (~1000 sites): what share continues work after a typed failure and genuinely needs branching, and what share is expressed with `catchTag`/`catchTags`/`mapError`.
3. Hand-rolled mechanisms beside Effect primitives: subscriptions on `Set`, memo maps, pools, waits on `Promise` and `Deferred` — which are replaced by `PubSub`, `SubscriptionRef`, `Cache`, `Pool`, `FiberMap`, and which (e.g. `held`) honestly have no analogue.

Proof of completion is a recorded finding per question, with example sites and the proposed shape.
