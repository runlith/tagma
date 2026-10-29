---
id: 01a13e02-ec6b-7ae6-ae1c-bad31d1b7f8e
title: Migrate the registry, model dialect, spans and token measurement tests to Effect
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/modelDialect.test.ts
  - kind: file
    ref: packages/agent/src/agent/spans.test.ts
  - kind: file
    ref: packages/agent/src/registry/Registry.test.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/calibration.test.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.test.ts
---
Migrate Registry, modelDialect, spans, calibration and ThreadRequestMeter to @runlith/effect-test with no manual runners. Keep typed collision and the parse refusal with source data, the registration lifecycle, persistence/retry and the token-prefix proof; remove success-only span smoke and prose-pinning. Shrink fixtures to the data the contract needs. Proof is the five files' tests, typecheck, check_law and one review round.
