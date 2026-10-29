---
id: 01a1514e-e150-73a0-a018-648ac59aa1c5
title: Restore the commit queue after journal worker death with journal-memory reconciliation
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-4574-7684-865c-7ed4b33184f8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15134-0b9f-7e2c-809e-ec1fa8827ffd
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/commits/queue.ts
    symbol: openJournal
---
Restore CommitQueue availability without a server restart after error/messageerror/close of the journal worker. In apps/tagma/server/src/enforcement/commits/queue.ts:51–70 the failure latch stays for the whole scope: future admits refuse, while successful judgements without settlement grow unstruck; judging/ruleChecks.ts:371–382 returns such admissions as unjudged. Ordinary I/O exceptions inside journal.worker.ts:22–24 already return a failed answer and don't engage the latch. Simply replacing the worker is unsafe: append/fsync may have completed before ACK loss, so the main process's next/waiting/held haven't changed yet while the restored journal already holds the record; a similar lost settlement ACK diverges from unstruck. Besides, judge runs outside the journal semaphore, so recovery must reconcile its current work with the new durable snapshot. Start with openJournal and admit/settled in queue.ts, journalAt/append/settle in journal.ts, and postMessage in journal.worker.ts; the owner stays the commit queue. Don't repeat the current record with an undefined result, don't wipe the journal and unread, don't reuse another record's seq; restore waiting/held/next/unstruck and the close order without unbounded work on the server loop. Proof is public fault-injection checks of worker death before the write and after durable append/settle before ACK: subsequent admission is available again, all durable records and unread are restored without loss or seq collisions. Reconciliation with the journal in a new worker without repeating the undefined request is implemented; subsequent admission availability is restored. 9 prior queue tests and 6 public fault-injection scenarios verified; an independent review of the whole delivery found no defects. bun run typecheck passed; the latest run on the shared tree found only someone else's error in remeasure/rule.ts:344. If judgement succeeds but settlement isn't recorded, durable unstruck stays until a new scope and blocks downgrade; a lost ACK of a durable settlement creates no such restriction. Live-server failure rate, latency, and power loss weren't measured; the server wasn't restarted.
