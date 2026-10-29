---
id: 01a13dd3-9399-7ce6-9438-904b22c5c29f
title: Migrate the deferred tools and runner checks to scoped Effect
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentDeferredTools.test.ts
---
Migrate AgentDeferredTools.test.ts to effect-test, keeping the query, reveal, catalog-grant and checkpoint contracts. The runner's lookup and launch return Effect, the scope owner closes the runner; the JSON checkpoint is decoded by the effect. Merge the readonly query scenarios without removing assertions. Proof is the file's tests, typecheck, check_law and review.
