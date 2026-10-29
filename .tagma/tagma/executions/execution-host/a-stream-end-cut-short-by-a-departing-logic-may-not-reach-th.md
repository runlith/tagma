---
id: 01a16686-3a2d-7ef5-8538-5f194e81de32
title: A stream end cut short by a departing logic may not reach the store before its handover to the successor
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16643-0934-7ef4-b48b-a8a3c7479dac",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16675-ba00-7c2f-8f1b-dad78a43d7ae
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.suspend
  - kind: symbol
    ref: packages/execution-host/src/registry/departure.ts
    symbol: depart
---
The next logic does not continue by payload a stream the execution store calls ended-with-error while the journal holds it open ([[8ae259eb]]). The store learns a stream's end from the pipeline itself: after its capture act returns, `sourceEnded` writes the state. When capture hangs on a carrier and suspend cuts it short at the logic's departure, that write races the rest of the departure and is not ordered with `store.handover()`. The pipeline usually wins it: suspend is still waiting on the journal line with the stream end. But if the journal refuses fast and the capture act was cut, the store can pass to the successor without this stream's end, and the successor takes the frontier by payload length.

The ordering belongs to the departure owner: suspend knows the streams whose ends the journal did not take, and the departure can write their ends into the store before handover. The test should reproduce losing this race deterministically; without a seam in the pipeline or the store none has been devised yet.
