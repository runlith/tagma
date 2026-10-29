---
id: 01a13fc7-244e-77c7-aaa4-0a2d28c11aed
title: Migrate question and confirmation settlement to scoped Effect tests
ord: 16
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
    ref: packages/agent/src/thread/run/ThreadQuestion.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ToolQuestion.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ToolQuestionFailureScope.test.ts
---
Migrate ThreadQuestion.test.ts, ToolQuestion.test.ts and ToolQuestionFailureScope.test.ts to @runlith/effect-test with a shared scoped door fixture only for the matching assembly. The invocation scope belongs to the test, helpers give Effect, time is TestClock; full ThreadRunRow and port contracts instead of casts, failures read on the typed channel. Keep ask_user grouping and gated calls, no execution before confirmation, a partial answer as refusal, cancellation/failed/denied outcomes, the deadline from the question time, unchanged prepared resolution and address collisions; delete string/copy checks and mock bookkeeping or replace them with public state/output contracts. A clear defect gets fixed at the producer red→green with spans. Checks: each file separately with --parallel=1, bun check -p packages/agent, scoped check_law, one Sol+Muse round and metrics. Questions.parked and ThreadAggregate are separate assemblies; leave a01ffa22 alone.
