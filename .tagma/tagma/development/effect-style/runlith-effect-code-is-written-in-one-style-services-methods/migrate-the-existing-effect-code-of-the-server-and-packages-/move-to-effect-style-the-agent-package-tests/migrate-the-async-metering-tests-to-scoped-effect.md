---
id: 01a14021-cf96-7bf1-9b60-8dd04ad88f2e
title: Migrate the async metering tests to scoped Effect
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.itest.ts
---
Migrate ThreadRequestMeter.itest.ts to @runlith/effect-test: keep sync and async metering equal, concurrent length framing independent, and immutable prefix reuse. Replace bare runners/Promise.all with it.effect and Effect.all with concurrency 2. Change no production; no storage/world needed. Proof: serial file test, scoped typecheck, law, one Sol+Muse round, landed diff.
