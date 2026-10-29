---
id: 01a1516d-042d-7f8f-874d-651e937be631
title: A thread snapshot does not refuse when the journal moves under its read
ord: 74
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-0eea-710a-ae9d-90350dfe84ea",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
    symbol: makeThreadSnapshots
---
Opening a busy thread (agent commands, child reports, signals) showed the operator a `Thread … changed during both snapshot reads.` banner: `readCut` in `ThreadSnapshots` read the snapshot twice and gave up when the journal head moved both times. Fixed in `readCut`: on a shift the second read runs inside the store's write unit, where the journal cannot move, and there is no refusal anymore. Proof is a `ThreadSnapshots.test.ts` test with a writer on every page read.
