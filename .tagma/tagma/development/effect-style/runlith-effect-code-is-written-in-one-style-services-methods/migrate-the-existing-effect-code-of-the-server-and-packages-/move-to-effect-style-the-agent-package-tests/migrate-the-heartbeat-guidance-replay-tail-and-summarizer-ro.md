---
id: 01a13df6-b74f-775f-828e-5d41c59eeab9
title: Migrate the heartbeat, guidance replay, tail and summarizer routing tests to scoped Effect
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/RunBeater.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunGuidance.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/SummarizerRouter.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadTail.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadTailReads.test.ts
---
Migrate the five files RunBeater, RunGuidance, ThreadTail, SummarizerRouter and ThreadTailReads to Effect tests with no manual runtimes. Full doubles or real memory ports replace partial casts, TestClock moves the heartbeat with no real-time flush, guidance keeps replay/reset/isolation, tail keeps hydration and exchange integrity, summarizer keeps the admitted catalog. Reduce fixtures to the minimal data keeping the boundaries and the algorithmic contract. Proof is the group's tests, typecheck, check_law and one review round.
