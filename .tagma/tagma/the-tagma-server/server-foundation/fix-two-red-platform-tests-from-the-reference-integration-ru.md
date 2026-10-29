---
id: 01a17adc-d139-7662-bd19-858e29477368
title: Fix two red platform tests from the reference integration run
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ad7-b547-72ac-8bf1-2b6e4e287cfc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16ded-8a52-7d5c-b651-dea1ff12c6b8
---
Fix two test assumptions from the b19d85d integration run. `spawn.itest.ts`: `Stream.toPull(FileSystem.watch(...))` does not open the subscription yet; the child manages to create ready before the first pull, and the test never reaches cancellation. A deterministic schedule over an independent native watch fact on Bun 1.4.4 at load 17.56 reproduced the hang and a 180099.67 ms guard with one dangling process. An eager scoped watcher before fork keeps readiness; alive→ESRCH and waiting on Fiber.interrupt do not change. `tree.itest.ts`: opening a subscription delivers named events before the mandatory unnamed, so exact equality of the whole queue is the wrong assertion; checked are disabled watching during withholding, the restored handle, the mandatory unnamed, a genuinely missed write found by rescan, and the next write through the watcher. Each file alone passed seeds 1/2/3: 36/36 total; typecheck passed. `check:change` over the shared diff picked 634 server files and was stopped on the lead's word: its own files' checks were taken instead; product code did not change. The [[01a17ae9-b100-7c5e-8aa9-2e18c4e6374e|independent reviewer]] found no material findings; the probe sets a sufficient spawn-race mechanism, though the baseline never kept the hang point.
