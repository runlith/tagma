---
id: 01a1668c-ef76-7802-8067-4d77968b40cb
title: "A write act's deadline does not bound an act whose carrier never interrupts: the refusal waits for the carrier's end"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16643-0934-7ef4-b48b-a8a3c7479dac",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16686-3a2d-7ef5-8538-5f194e81de32
sources:
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.answered
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.bounded
---
A write act's deadline cuts it short by interruption. `bounded` goes through `timeoutOrElse`, which starts `orElse` only after the source is fully interrupted. `answered` cuts the carrier through `Fiber.interrupt`, which awaits its fiber's end. An act the platform does not interrupt holds the refusal until the carrier answers. That is how `fs.open` behaves: it goes under an acquire mask, while the journal opens a file per line. In the end the stream end, suspend and seal hang on a carrier that never answers, against [[8ae259eb]].

Proven by probe in `tornRecordHandover.itest.ts`: a stdout append held without interruption (`heldThroughInterrupt`) holds suspend at the logic's departure, and the departure does not finish within 30 s.

A refusal need not await a cut carrier: the record already survives a torn record's late landing (the frontier cuts back, the stream fences, ends reach the store). What is needed is a refusal that lifts the wait at once while interrupting the carrier without awaiting it. The handle `open` hands over later must then close inside the segment's already closed scope.

Test: an act held without interruption ends on time on the stream-end, suspend and seal paths.
