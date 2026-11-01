---
id: 01a1949a-588a-7353-9bd7-1cad7d3d9bc3
title: A run that carries only lapsed unread words ends withdrawn again, as the transport contract expects
ord: 26
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c0a990be94
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/transport.ts
---
The transport contract case "a request whose words lapsed unread reports once to its sender, closes once, and withdraws a run that only carries them" (`packages/agent/src/thread/conformance/transport.ts:392`) is red on memory storage (`packages/agent: testbed bun test --no-isolate ./src/thread/conformance/storagePort.test.ts -t "words lapsed unread"`) and on the real store (`apps/tagma/server: …/composition/testing/native-harness/storageRuns.itest.ts`): the run ends `aborted` with `stopRequest.withdraw: true` where `withdrawn` is expected. Another session reproduced it on a clean checkout of `dc53b52c`, so it predates the memory-budget work that found it. Path read by that session: `RunReports.lapsed` → `RunLifecycle.stop(withdraw: true)` → closing/withdrawn turn. Find why stopping a run that only carries request words no longer withdraws it, and fix it at the lifecycle owner.