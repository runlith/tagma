---
id: 01a13f4e-97a2-7982-a11e-4fe78e1ea5be
title: Migrate the run's execution, lifecycle, inbox, reaper and contexts tests to Effect
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunLifecycle.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunExecution.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunContexts.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunInbox.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunReaper.test.ts
---
Migrate the RunExecution, RunLifecycle, ThreadRunInbox, ThreadRunReaper and ThreadRunContexts tests to @runlith/effect-test with full port doubles in closures, the test owner scope, and Deferred/Stream/TestClock instead of runners, sleeps and yieldNow polling. Keep pre/post-tracking stops, boundary/settlement waiting, interruption opener/resumption, handover, typed refusals and cleanup; lifecycle claims/park/stop/replay; inbox selection and confirmation; reaper ownership/lease/recovery; context snapshots. Delete forwarding/mock-bookkeeping checks or observe state through the public owner; reuse the shared assembly only when contracts match. A clear bug proven red→green gets fixed at the producer with all spans. Proof is targeted single-file tests with --parallel=1, bun check -p packages/agent, check_law, one review round and each file's metrics.
