---
id: 01a16065-ed20-731a-889d-a7eff7d14611
title: Measure the timeout rewind conformance and remove the cost at the owner if there is one
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1605a-ae18-7ace-b8b6-f474bfdcb0ad",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d57-b5bc-706f-890c-4c35a0609fb5
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d37efa9a83
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/rewind.test.ts
---
A dropped middle turn's scenario once ended in a timeout after 1023.63 ms against a 1000 ms limit in a full `bun test --parallel=2`. Isolated, 50 repeats passed in 1.442 s including file load; observed warm repeats took 10–20 ms. In 10 separate fresh Bun processes the test took 90.59–100.25 ms, median 93.88 ms. Three following full package runs: 99.24, 142.77, and 138.42 ms for that scenario. All these checks ran without changing the test or the limit.

The scenario creates one in-memory storage and one harness, runs four short scripted turns, and verifies history before/after rewind and restore. Ends await via subscription and Deferred (`answered → pump`), with no sleep or polling. Repeated reads there verify different states of a short history; no separate source of a second of work was found. During the isolated measurement the machine was not saturated (26% on 12 cores, normal memory pressure); the load at the moment of the original timeout is unrecorded, so that delay's concrete cause is not established. No stable test slowness confirmed; code and limit left unchanged, no separate commit.
