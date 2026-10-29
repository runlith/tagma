---
id: 01a16fc4-3684-79e6-bea8-3e2163aa39e1
title: A thread subscription does not guarantee a frame after background settlement confirmation
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "After replacing poll with subscribe, the ordinary message test hung to 1000ms; in RunLifecycle.closed tx-path changes.publish called right after outbox.wake, while ThreadSettlementOutbox after markSettledNotified publishes no change.",
    "command": "../../../node_modules/.bin/testbed bun test --no-isolate --randomize --seed=3 ./src/composition/testing/threads/requestObligation.test.ts",
    "expected": "Waiting on settledNotifiedAt via harness.reads.subscribe completes after background settlement confirmation without polling snapshot."
  }
---
Filed from project `runlith`.

Green on seeds 1 and 2, the same scenario fails on seed 3 after 10 expects (plain child took and reported two tasks, waiting on the ordinary message end hung). Report /tmp/runlith-test/reports/run.55896.1792876442903.jsonl. Code path: packages/agent/src/thread/run/lifecycle/RunLifecycle.ts:234 calls announce(...,'woken') and changes.publish; outbox.wake returns after fork. packages/agent/src/agent/ThreadSettlementOutbox.ts:144 writes markSettledNotified but does not call changes.publish. This explanation needs deterministic reproduction and owner verification.
