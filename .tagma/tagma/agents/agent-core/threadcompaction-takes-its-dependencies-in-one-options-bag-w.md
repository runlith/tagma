---
id: 01a0d9ce-8def-7ff7-b78b-5e685d6e2c8e
title: ThreadCompaction takes its dependencies in one options bag, which the summarizer port joined; law c2f04d22 wants each positional
ord: 138
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d980-79cc-7222-9327-daa9fce8a039
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
    symbol: ThreadCompaction
---
The constructor takes models, checkpoints, policy, the two strategies, the text, the transcript-location reader, the calibration store and — since fce8a039 — the summarizer port in one object. Law [[c2f04d22]] wants every dependency as its own positional parameter and an options object that holds only optional values that are not dependencies. About fifty call sites construct it, most of them tests.

Done when every dependency of `ThreadCompaction` is positional, the options object carries no dependency, and the call sites build it that way.