---
id: 01a13f39-fc76-7641-9749-d778ea81a69a
title: Migrate the run's accounting, owners, cycle and settlement outbox tests to Effect
ord: 14
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
    ref: packages/agent/src/thread/run/ThreadRunAccounting.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunCycle.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunOwners.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSettlementOutbox.test.ts
---
Migrate the ThreadRunAccounting, ThreadRunOwners, ThreadRunCycle and ThreadSettlementOutbox tests to @runlith/effect-test, with test-owned scopes and event-based waits. Keep stop actor, park/settle, flush order and terminal events, tail retry/loss, cleanup, subscriber/confirmation/observation failures, claims, redelivery and exactly one subscriber effect. Replace partial port casts with full doubles; add a shared Effect fixture only for a genuinely shared run assembly. Delete forwarding/mock bookkeeping or verify by the owner's state. If the Clock test reproduces wrong ThreadRunAccounting stamps, fix the source in this group red→green, keeping spans. Proof is the group's tests, typecheck, check_law, one review round and per-file metrics.
