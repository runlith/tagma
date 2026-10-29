---
id: 01a0cb08-7797-7874-9904-1e61a2276c1c
title: The run-log suite's delete test asserts the thread row is gone and never reads the inbox it is named for
ord: 137
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/thread/conformance/runLog.ts
    symbol: describeThreadRunLog
---
`deleting a thread with words waiting takes them with it` queues a turn behind a hanging run, deletes the thread and then asserts one thing: that the aggregate row is gone. The waiting envelope is never read back, so a host whose inbox rows outlive the thread they belong to passes this suite with orphaned words in its store — which is the single failure the test exists to catch.

Add the read: after the delete, assert the inbox for that thread answers empty. If the cascade is the storage engine's rather than the port's, that is worth stating as a claim of its own, because a host on another engine has to make it true by hand.

Then [[694058c8]] can say the delete case obliges what its name promises.