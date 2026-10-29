---
id: 01a16e81-2599-7de2-b6cd-8387a311e265
title: The settlement outbox writes no entering/done to a subscriber with no work for the run
ord: 11
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSettlementOutbox.ts
---
The x-record-fix measurement in `approver.itest.ts`, one sample under load: 8 "root birth + child with first turn" pairs yielded 13,491 SQL statements, about 1,700 per pair. The settlement outbox writes most: every subscriber writes `entering` and `done` in a separate transaction, even when it has no work for the run. That is about 30 write transactions per run — 476 `update thread_run set settled_notification` and 783 BEGIN/COMMIT.

A subscriber with no work for the run should leave no entries. That yields fewer transactions per run both in the product and in every door test. The exactly-once guarantees and the diagnostics of a subscriber that has work must survive; for that, first read the outbox contract at its owner.

Deferred until the x10 measurement ends.

**Released without a fix: only the subscriber itself knows "no work", and the `entering` write is the claim check before its work.**
- The `ThreadRunSettledSubscriber` declares only `name` and `handle(event)`. Whether it has work is decided by the `handle` body: `open question` looks at `settledOutcome(event)`, `native parking` lifts parking only when it stands, `compaction waiters` wakes waiters only when there are any. The outbox (`ThreadRunSettlements.publish`) does not see that before the `entering` write.
- `entering` is `writeSettledNotification` under `notificationClaim(runId, expectedId)`. When another owner intercepted the claim (reclaim after a stale heartbeat), the write answers `false` and `publish` falls with `SettlementClaimLost` before the subscriber's work. Without that entry the subscriber would run under someone else's claim, and exactly-once would rest only on each `handle`'s idempotency. `done` appends the name to `delivered`, and by it a repeat after failure skips already-served subscribers. `phase` and `subscriber` from `entering` become `lastFailure` on failure.

A path that would keep the guarantees: a subscriber declares that its work lives only in the process memory and needs no repeat after restart (`native parking`, `step-boundary stops`, `compaction waiters`, `run context close`). For such a subscriber the outbox writes neither `entering` nor `done` and launches it after the first `entering` write of the next durable subscriber or in the publication phase. That changes the subscriber contract, not skips "empty" work. Its decision belongs to the agent-core owner.
