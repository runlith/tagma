---
id: 01a13dcc-7144-7d52-9928-989b08fe159a
title: "Migrate the small agent Effect tests: transaction, transport, aside and stream sink"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentAside.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStreamSink.test.ts
  - kind: file
    ref: packages/agent/src/thread/storage/memory/transaction.test.ts
  - kind: file
    ref: packages/agent/src/thread/transport/Transports.test.ts
---
Migrate the four small test files to effect-test, keeping the assertions on typed refusal, rollback on interruption, transport registration and interrupt routing, aside prefix and origin, and stream sink event order. Shared layers once per group, waits on Deferred. Proof is the group's tests, typecheck, clean check_law and an independent review.
