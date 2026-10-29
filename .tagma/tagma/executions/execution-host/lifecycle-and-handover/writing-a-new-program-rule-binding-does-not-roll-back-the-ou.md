---
id: 01a14dcd-7f50-7a7d-87f2-ed9e5c0ce263
title: Writing a new program-rule binding does not roll back the outcome of an already finished stop
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/src/ProgramRules.ts
    symbol: makeProgramRules
---
The observation Round waits for the bindings to be written to the store, while the stop ladders and the deadline extension continue in separate fibers. So publishing new bindings supplements the holder's current state: finished rulings, already covered descendants, and the finished extension must not be replaced with a snapshot from before the write. Running Rounds back to back does not serialize these participants on its own.
