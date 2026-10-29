---
id: 01a11b25-5715-73d9-a9ff-dc621508676d
title: compactionParent conformance fits the 1.5 s unit-test budget
ord: 31
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-911ed3c0852f
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/compactionParent.test.ts
---
`packages/agent/src/thread/conformance/compactionParent.test.ts` in the InMemory variant spends 2151 ms of CPU time (measured by `test/layers.ts` at 780c61600a). That is over the 1.5 s budget from rule ad3c527d. Either load and compute less in what the test pulls in, or move the file to the `*.itest.ts` layer. Done when `test/layers.ts` no longer reports a budget overrun for this file.
