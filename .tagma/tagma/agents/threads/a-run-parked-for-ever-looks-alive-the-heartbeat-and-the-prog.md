---
id: 01a0cb40-d44e-7dc4-80d9-bfd06de28ced
title: "A run parked for ever looks alive: the heartbeat and the progress clock are both recorded and never compared"
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cbfc-91ad-7be4-b090-88f6709e240d",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/rhythm.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadRunLease.ts
    symbol: heartbeat
---
Measured 2026-09-22: a `grep` whose child never settled parked its run for 98.9 minutes, and nothing in the server could see it. The row carried both facts at once — `progress.activity.since` at 19:51:04.759 and `heartbeat_at` at 21:29:59.900 — and no reader compares them.

The heartbeat is not the liar, which is why this is cheaper than it first looks. `ThreadRunLease.heartbeat` forks `forever(sleep → markAlive)` and touches only `thread_run.heartbeat_at`; durable movement is recorded separately on `thread.updated_at`, honestly, and stays put while a run is parked. Measured across the eleven live runs at 22:28Z, thread idle ran 0.6–6.6 minutes against a beat age of 0.0 — so the two clocks are independent and both true. What is missing is the comparison and a read that can express it.

Two exclusions, neither invented: a run at `progress.stage = 'awaiting-question'` is waiting on a person, not stuck, and `reapClaim` already spells that exemption — a 9.15-day running row stands under it by design. An invocation moved to the background released its wait on purpose and is the second.

The phase clock is the wrong mark: `progress.activity.since` moves only when the phase changes, and two healthy runs sat 9.5 minutes inside one `calling` phase that evening. Use the thread's last durable movement.

A threshold of 1,200,000 ms follows the bounds rather than taste: a model step tolerates `AGENT_IDLE_MS` 300,000 of silence with one retry, so the worst legitimate model silence is 600,000, and a tool invocation is bounded by the call envelope at twice the shipped one-shot `executionMs`. Past the widest legitimate gap, a bound that should have fired did not — which is the thing worth announcing.

The pass must only name. Killing loses the work and is unnecessary: `control_call` already ends an invocation and already worked on this one. What the operator lacks is the sighting, not the act.

Why it was not built: the remaining work is a state predicate threaded through five boundaries — `list_threads` cannot select `running` at all (`updatedBefore` answered 1209 threads across every state, the stuck one invisible among them), so `protocol/threadSelection.ts`, the agent-package selection type, the directory store predicate and the tool schema all move, plus a `ThreadRunReapSelector` variant with its SQL and a storage-conformance case.

Unproven: that `thread.updated_at` is untouched by the heartbeat is an observation over eleven rows, not a reading of every writer of that column — confirm at the writer before building. Nobody has measured the distribution of healthy inter-movement gaps over more than one evening, which is the one measurement that could move the threshold.